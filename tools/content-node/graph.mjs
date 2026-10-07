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
function fromFile() {
  const file = process.env.CONTENT_NODE_ENV_FILE || path.join(homedir(), '.content-node.env');
  try {
    const found = {};
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

const file = fromFile();
const setting = (key, fallback = '') => process.env[key] || file[key] || fallback;

const URI = setting('NEO4J_URI', 'bolt://127.0.0.1:7687');
const USER = setting('NEO4J_USER');
const PASSWORD = setting('NEO4J_PASSWORD');
const DATABASE = setting('NEO4J_DATABASE', 'graph.db');

let driver;

/** Whether credentials are present; the server says so rather than failing per request. */
export function configured() {
  return Boolean(USER && PASSWORD);
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
    // Small: this shares a database with the service it is being compared
    // against, and a diff run over thousands of ids should not be what makes
    // beta slow.
    maxConnectionPoolSize: 8,
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
export async function read(cypher, parameters = {}) {
  const session = connection().session({
    database: DATABASE,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const result = await session.run(cypher, parameters);
    return result.records.map((record) => plain(record.toObject()));
  } finally {
    await session.close();
  }
}

/** Neo4j's own types, flattened to what JSON would carry. */
function plain(value) {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    // Nodes and relationships carry their properties under .properties.
    const source = 'properties' in value && value.properties ? value.properties : value;
    if (source instanceof Date) return source.toISOString();
    const out = {};
    for (const [key, entry] of Object.entries(source)) out[key] = plain(entry);
    return out;
  }
  return value;
}

export async function close() {
  await driver?.close();
  driver = undefined;
}
