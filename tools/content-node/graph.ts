/**
 * The graph database, for the node port of the content service.
 *
 * Credentials come from the environment and nowhere else. The Java service keeps
 * them in `application.properties` inside its deployed webapp; this reads
 * NEO4J_URI, NEO4J_USER and NEO4J_PASSWORD so the secret lives in the process
 * that needs it rather than in this repository.
 *
 * Read-only by construction: every query runs in a READ session. The database is
 * shared with the Java service that beta depends on, so nothing here may write,
 * and the pool is small on purpose -- a port that slows the site it is replacing
 * has not replaced anything.
 */
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Credentials from a file, read literally.
 *
 * Sourcing the file in a shell looked simpler and silently produced an empty
 * password: these are generated secrets, and a `#` or `$` in one means the shell
 * treats the rest of the line as a comment or expands it to nothing. Reading the
 * file here parses KEY=VALUE as exactly that, and the environment still wins so
 * a deployment can inject credentials without a file at all.
 */
function fromFile(): Record<string, string> {
  const file = process.env['CONTENT_NODE_ENV_FILE'] || path.join(homedir(), '.content-node.env');
  try {
    const found: Record<string, string> = {};
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const at = line.indexOf('=');
      if (at < 1 || line.trimStart().startsWith('#')) continue;
      found[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return found;
  } catch {
    return {};
  }
}

/**
 * TCP_NODELAY on every connection this process opens, the graph's included.
 *
 * neo4j-driver sets keep-alive on its socket and nothing else, so Nagle's
 * algorithm stays on. A request bigger than one segment -- about 1.4KB of
 * Cypher and parameters, which several endpoints' queries are -- then holds
 * its last segment back until the server acknowledges the first, and the
 * server delays that acknowledgement: 43ms on every such query against 2ms,
 * measured on beta's graph container (15 Oct 2026). Java's driver turns Nagle
 * off; the driver gives no option to, so the socket's connect does. The
 * process's other outgoing connections (fetch, through undici) set it already.
 */
/** Socket#connect, marked once replaced so it is replaced once. */
type Connect = typeof net.Socket.prototype.connect & { noDelay?: true };
const connect = net.Socket.prototype.connect as Connect;
if (!connect.noDelay) {
  net.Socket.prototype.connect = Object.assign(
    function connectWithoutDelay(this: net.Socket, ...args: unknown[]) {
      this.setNoDelay(true);
      return (connect as (...args: unknown[]) => net.Socket).apply(this, args);
    },
    { noDelay: true as const }
  ) as Connect;
}

const file = fromFile();
const setting = (key: string, fallback = ''): string => process.env[key] || file[key] || fallback;

/** A setting from the environment or, failing that, the credentials file (settings.ts). */
export const envSetting = setting;

const URI = setting('NEO4J_URI', 'bolt://127.0.0.1:7687');
const USER = setting('NEO4J_USER');
const PASSWORD = setting('NEO4J_PASSWORD');
const DATABASE = setting('NEO4J_DATABASE', 'graph.db');

let driver: Driver | undefined;

/** Whether credentials are present; the server says so rather than failing per request. */
export function configured() {
  return Boolean(USER && PASSWORD);
}

/** GRAPH_POOL_SIZE when it is a whole number from 1 to 100; otherwise 32. */
export function poolSize(setting: string | undefined) {
  const size = Number(setting);
  return Number.isInteger(size) && size >= 1 && size <= 100 ? size : 32;
}

function connection() {
  if (!configured()) {
    throw new Error(
      'NEO4J_USER and NEO4J_PASSWORD are not set. The Java service keeps them in ' +
        'ContentService/WEB-INF/classes/application.properties; export them rather ' +
        'than copying them into this repository.'
    );
  }
  driver ??= neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
    // Bounded, because the database is shared with the Java service, but not
    // so small that a few slow requests hold every connection: at 8 -- sized
    // for the diff harness -- eight parallel deep queries from one client
    // stalled every other graph route for the acquisition timeout. Java's pool
    // holds 100. A request that still finds none free is a 503 (timedOut).
    maxConnectionPoolSize: poolSize(process.env['GRAPH_POOL_SIZE']),
    connectionAcquisitionTimeout: 10_000,
  });
  return driver;
}

/**
 * Run one read query and return plain objects.
 *
 * Neo4j integers arrive as {low, high} pairs, which is a faithful representation
 * of a 64-bit value and a trap when the answer is compared against JSON from
 * another implementation: 74160 must serialise as 74160, not as an object.
 */
/**
 * **Match by an indexed property, never by label alone.**
 *
 * This instance has **no token (LOOKUP) index** -- `SHOW INDEXES` reports 36
 * indexes and none of them is one -- so `MATCH (n:Label)` cannot use a label
 * index and the planner falls back to scanning every node and filtering.
 * Measured on `MATCH (n:DBInfo) RETURN n.releaseNumber`, which matches exactly
 * one node:
 *
 *     EXPLAIN ->  AllNodesScan  +  Filter n:DBInfo
 *     nodes in the database      2,958,129
 *     time                       ~700ms
 *     the same read via an indexed property (DatabaseObject.dbId)   29ms
 *
 * So the cost has nothing to do with how many nodes match or how many rows come
 * back: one node and four hundred cost the same, because both scan three
 * million. That is also why Java's own `/data/species/main` takes 682ms.
 *
 * Two consequences for anyone porting an endpoint:
 *
 * 1. Prefer a property that is indexed, and match it **under the label the
 *    index is on** -- `dbId` is on `DatabaseObject`, and Neo4j treats `Person`
 *    as an unrelated label, so `(p:Person) WHERE p.dbId = …` scans while
 *    `(n:DatabaseObject) WHERE n.dbId = …` does not.
 * 2. When an endpoint genuinely needs every node of a label -- the species
 *    lists do, and no property can express that -- there is no query that
 *    avoids the scan. Wrap it in `cached()` so the scan is paid once at
 *    startup rather than on a request path.
 *
 * The real fix is one statement from whoever owns the database:
 *
 *     CREATE LOOKUP INDEX node_labels FOR (n) ON EACH labels(n)
 *
 * It would make every label match fast for the Java service too. It is a schema
 * write on a shared instance, so it is not taken here.
 */
/**
 * How long one read may run before the database ends it.
 *
 * The database is shared with the Java service beta depends on. On 15 Oct
 * 2026 deep in-depth queries -- the kind any caller can ask for with
 * maxDepth=-1 and a long `attributes` -- ran it out of memory, and Tomcat,
 * which cannot start without it, was down until it was restarted. The
 * slowest query this service needs is ~10s (the content tables, at startup);
 * past 30s the request is answered 503 (answers.ts, timedOut) and the
 * database is let go.
 */
export const READ_TIMEOUT_MS = 30_000;

/**
 * A value as read returns it: Neo4j's integers as numbers (as strings past
 * 2^53), dates as ISO strings, maps and lists of the same; with `graph`,
 * nodes and relationships as GraphNode and GraphRelationship.
 */
type GraphValue = null | boolean | number | string | GraphValue[] | { [key: string]: GraphValue };
/**
 * A node's properties (properties(n), or GraphNode.props): absent ones are
 * not there, not null. The ones every DatabaseObject may have are named.
 */
export type Properties = {
  [key: string]: GraphValue | undefined;
  dbId?: number;
  stId?: string;
  displayName?: string;
  schemaClass?: string;
  speciesName?: string;
  doi?: string;
  databaseName?: string;
  identifier?: string;
  // A Person's.
  surname?: string;
  firstname?: string;
  orcidId?: string;
};
/** One record, by column. A caller names the columns its query returns. */
export type Row = { [column: string]: GraphValue };
/** A node, read with `graph`. */
export interface GraphNode {
  id: number | string;
  labels: string[];
  props: Properties;
}
/** A relationship, read with `graph`. */
export interface GraphRelationship {
  id: number | string;
  type: string;
  start: number | string;
  end: number | string;
  props: { [key: string]: GraphValue };
}

/**
 * Run a read; each record as a plain object, typed as the caller says its
 * query returns (R) -- the driver checks nothing of that. With `graph`, nodes and
 * relationships keep what an object mapper needs -- {id, labels, props} and
 * {id, type, start, end, props} -- so a Java query can be sent as written
 * and its result mapped as Spring Data maps it (domain.ts, mapResults).
 */
export async function read<R = Row>(
  cypher: string,
  parameters: Record<string, unknown> = {},
  { graph = false } = {}
): Promise<R[]> {
  const session = connection().session({
    database: DATABASE,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const result = await session.run(cypher, parameters, { timeout: READ_TIMEOUT_MS });
    return result.records.map((record) =>
      graph ? withGraph(record.toObject()) : plain(record.toObject())
    ) as R[];
  } finally {
    await session.close();
  }
}

/** As plain, but nodes and relationships with their ids, labels and ends. */
function withGraph(value: unknown): GraphValue {
  if (value instanceof neo4j.types.Node)
    return { id: plain(value.identity), labels: value.labels, props: plain(value.properties) };
  if (value instanceof neo4j.types.Relationship)
    return {
      id: plain(value.identity),
      type: value.type as string,
      start: plain(value.start),
      end: plain(value.end),
      props: plain(value.properties),
    };
  if (Array.isArray(value)) return value.map(withGraph);
  if (value && typeof value === 'object' && !neo4j.isInt(value)) {
    const out: { [key: string]: GraphValue } = {};
    for (const [key, entry] of Object.entries(value)) out[key] = withGraph(entry);
    return out;
  }
  return plain(value);
}

/** Neo4j's own types, flattened to what JSON would carry. */
function plain(value: unknown): GraphValue {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    // Nodes and relationships carry their properties under .properties.
    const source = 'properties' in value && value.properties ? value.properties : value;
    if (source instanceof Date) return source.toISOString();
    const out: { [key: string]: GraphValue } = {};
    for (const [key, entry] of Object.entries(source)) out[key] = plain(entry);
    return out;
  }
  // What is left is a boolean, number, string or null.
  return value as GraphValue;
}

export async function close() {
  await driver?.close();
  driver = undefined;
}
