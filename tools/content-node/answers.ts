/**
 * What the content service answers, written as Java writes it (spec 014,
 * research R1 layer 4): Jackson's JSON (javaJson, nonEmptyJson, compact),
 * Spring's error envelope and its 404s, the 500s and 503s a failure becomes,
 * and the cache a built answer is kept in. Moved unchanged from service.ts.
 */
import { javaDouble } from './domain.ts';
import type { Answer, Handler, Request } from './endpoint.ts';

/** Java's answer to an exception its handler has no mapping for: a NullPointerException. */
export function unexpected(request) {
  return javaError(
    request,
    500,
    'INTERNAL_SERVER_ERROR',
    'Something unexpected happened and the error has been reported.'
  );
}

/**
 * A Java object as the content service's NON_EMPTY mapper writes it: the
 * members in order, any null, empty text or empty list left out. A `double`
 * member is written as Java writes a Double (1.0, not 1).
 */
export function nonEmptyJson(members) {
  const out: string[] = [];
  for (const [name, value, double] of members) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const written =
      value instanceof RawJson ? value.text : double ? javaDouble(value) : javaJson(value);
    out.push(`${javaJson(name)}:${written}`);
  }
  return `{${out.join(',')}}`;
}

/** Text already written as JSON, for nonEmptyJson. */
export class RawJson {
  declare text: string;
  constructor(text: string) {
    this.text = text;
  }
}

/**
 * Text as Jackson writes it, which differs from JSON.stringify in one place:
 * a control character without a short escape is `\u001F`, upper-case, where
 * JSON.stringify writes `\u001f`. Only an escape is changed -- an odd run of
 * backslashes before `u00` -- never a literal backslash followed by text.
 */
export function javaJson(value) {
  return JSON.stringify(value).replace(/(\\+)u00([0-9a-f]{2})/g, (match, slashes, hex) =>
    slashes.length % 2 ? `${slashes}u00${hex.toUpperCase()}` : match
  );
}

/**
 * A Neo4j client error as Spring's exception translation reports it, for the
 * codes a caller names: an ArgumentError by default, which is what Java
 * answers a negative SKIP or LIMIT with. Undefined for any other failure:
 * those are not part of Java's contract to mirror.
 */
export function neo4jFailureMessage(failure, codes = ['Neo.ClientError.Statement.ArgumentError']) {
  if (!codes.includes(failure?.code)) return undefined;
  return (
    `${failure.message}; Error code '${failure.code}'; ` +
    `nested exception is org.neo4j.driver.exceptions.ClientException: ${failure.message}`
  );
}

/**
 * Build once, serve from memory, and heal from a bad start.
 *
 * Measured, which is the only reason this exists: Java answers both of these in
 * 3-7ms and this port answered in 4.5-6.2s, a thousand times worse. Java is not
 * faster -- `ContentPageManager` has a `@PostConstruct` that runs both queries
 * at startup and keeps the lists in memory, so the traversal is paid once per
 * deploy rather than once per reader. A port that skips that is a regression no
 * functional diff would catch, because every response is byte-identical and
 * merely slow.
 *
 * One deliberate difference. Java's init catches Exception, logs it and leaves
 * the list **empty**, so a database that is slow or unreachable at startup
 * leaves the contents page blank until somebody redeploys -- a transient fault
 * made permanent. Here a failed build is not cached: the next request tries
 * again. A slow start costs one slow request instead of an empty page nobody
 * connects to a restart hours earlier.
 *
 * Held for the life of the process, which makes restarting this service part of
 * updating the database rather than an optimisation detail. That is the agreed
 * rule, and it is the rule rather than an inference: the previous version of
 * this comment asserted that "a release restarts the service", which is true of
 * Java -- its WAR is redeployed -- and was not true of this, a container with
 * `restart: unless-stopped` that nothing restarted.
 *
 * What it costs to get wrong, so the rule is worth keeping: the release number
 * keys the bucket paths for diagrams, figures and icons, so a service holding
 * the previous release's number sends every one of those requests to the wrong
 * prefix, and keeps doing it silently. `/health` reports the release this
 * process is holding for exactly that reason -- a missed restart is then one
 * curl away from being obvious instead of invisible.
 */
export function cached(name: string, build: (request: Request) => Promise<Answer>): Handler {
  let ready: Promise<Answer> | undefined;
  const handler = async (request: Request) => {
    ready ??= build(request).catch((error) => {
      ready = undefined;
      throw error;
    });
    const started = Date.now();
    const answer = await ready;
    const spent = Date.now() - started;
    if (spent > 100) console.log(`[content-node] built ${name} in ${spent}ms`);

    // Serialised once, not per request. The body cannot change while the
    // process lives, and `res.json` would stringify a quarter of a megabyte
    // every time somebody asked. Measured over 20 requests: 5.4ms before,
    // against Java's 3.1ms, and the gap was this.
    answer.serialised ??= typeof answer.body === 'string' ? answer.body : javaJson(answer.body);
    return answer;
  };
  // Marks this one for warming at startup; a handler that reads its request
  // cannot be warmed, and saying so here keeps that decision beside the cache.
  handler.warms = true;
  return handler;
}

/** The five fields Java's SimplePerson carries, in its order. */
/** The keys T may leave out. */
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];

/**
 * T as built to be written as JSON: every field named, and one that T may
 * leave out allowed to be undefined, which JSON leaves out. A field T
 * requires must have its value -- the cast to T after is then only the
 * undefined-to-absent step JSON takes. Where a writer then applies Java's
 * non_empty (nonEmptyJson, compact), a required string that is empty is left
 * out too, which no type here can see.
 */
export type JsonWritten<T> = { [K in OptionalKeys<T>]-?: T[K] | undefined } & {
  [K in Exclude<keyof T, OptionalKeys<T>>]-?: T[K];
};

/**
 * What Jackson would actually serialise.
 *
 * `spring.jackson.default-property-inclusion=non_empty` in the Java service's
 * application.properties, so a field is omitted when it is null, an empty
 * string **or** an empty collection -- not just when it is null. The diff found
 * this the slow way: entries with no reviewers came back from Java without the
 * key at all while this returned `[]`, on fifteen pathways.
 *
 * Numbers and booleans are left alone: NON_EMPTY has no notion of an empty
 * number, so `0` and `false` are serialised.
 */
/**
 * An answer object before Java's non_empty: every field of T named, any of
 * them null or empty -- compact leaves those out. A required field of T may
 * be null here too, and is then left out, as Java leaves it out: the type
 * checks each field's name and kind, not that a required one has a value.
 */
type BeforeNonEmpty<T> = { [K in keyof T]-?: T[K] | null | undefined };

export function compact<T extends object = Written>(fields: BeforeNonEmpty<T>): T {
  const out: Written = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  // Every field left is a value of T's, as fields declared it.
  return out as T;
}

/**
 * Java's error envelope, which callers already parse.
 *
 * Reproduced rather than invented because a 404 here is part of the contract:
 * `/data/pathways/top/{taxId}` answers 404 for a species with no top-level
 * pathways, existent or not, and node was answering `200 []`. Nothing caught it
 * because the diff had only ever been run with valid species ids -- the
 * not-found path was never compared with anything.
 *
 * `url` is rebuilt from the request. Behind nginx that is the external URL,
 * because `proxy_set_header Host $host` preserves it; asked directly on
 * loopback it is the loopback address, which is what Java would say too. It
 * leaves the query out, as every Java error url does (javaError): this one
 * used to keep it, so `/pathways/low/entity/foo?species=9606` named the
 * species in its url where Java does not -- hidden from the diff harness by
 * the `.url` differences endpoints declare for the host.
 */
export function notFound(request, message) {
  return javaError(request, 404, 'NOT_FOUND', message);
}

/** An object written as JSON, built a property at a time. */
export type Written = { [property: string]: unknown };

/** The named properties that are actually present. Absent means omitted, not null. */
export function only(source, keys: string[]): Written {
  const out: Written = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/**
 * A query the database ended -- at graph.ts's time limit, by terminating
 * it, or at its memory limit: 503 in Java's envelope -- the request is not
 * malformed, the service will not answer it -- or undefined for any other
 * failure.
 */
export function timedOut(request, failure) {
  const code = String(failure?.code ?? '');
  // Every connection in use: the driver says so in its message alone. Not the
  // caller's fault and not for long, so the same 503 with a reason that fits.
  if (String(failure?.message ?? '').startsWith('Connection acquisition timed out'))
    return javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly');
  const ended =
    code.startsWith('Neo.ClientError.Transaction.TransactionTimedOut') ||
    code.endsWith('.Transaction.Terminated') ||
    code === 'Neo.TransientError.General.TransactionMemoryLimit' ||
    code === 'Neo.TransientError.General.MemoryPoolOutOfMemoryError' ||
    // The database itself out of memory, or not there: the driver's own codes
    // for an unreachable server or a lost session.
    code === 'Neo.TransientError.General.OutOfMemoryError' ||
    code === 'Neo.TransientError.Database.DatabaseUnavailable' ||
    code === 'ServiceUnavailable' ||
    code === 'SessionExpired';
  if (!ended) return undefined;
  return javaError(
    request,
    503,
    'SERVICE_UNAVAILABLE',
    'The query took longer than this service allows; ask for less (a smaller maxDepth, fewer attributes)'
  );
}

/**
 * Spring's own 404, for a path no mapping matches: not Java's envelope but
 * BasicErrorController's, with the time it was answered and the path as it
 * came.
 */
export function springNotFound(request) {
  const path = String(request.originalUrl ?? '').split('?')[0];
  return {
    status: 404,
    type: 'application/json',
    body: javaJson({ timestamp: Date.now(), status: 404, error: 'Not Found', path }),
  };
}

/**
 * What this service throws and catches: an Error, tagged with how it is to
 * be answered -- Solr busy, Java's own failure, Java's message, a Neo4j code.
 */
export type Failure = Error & {
  busy?: boolean;
  unexpected?: boolean;
  javaMessage?: string;
  code?: string;
};

/** Java's GlobalExceptionHandler answer to its own NullPointerException. */
export function unexpectedFailure(request) {
  return javaError(
    request,
    500,
    'INTERNAL_SERVER_ERROR',
    'Something unexpected happened and the error has been reported.'
  );
}

/**
 * Java's error envelope for any status. Its `url` is the request's without the
 * query string, which is how Java writes it. Serialised here, as Jackson
 * writes it (javaJson): a message carrying a control character -- the id or
 * parameter as given -- is `\u001F` in Java's, and was `\u001f` in ours.
 */
export function javaError(request, code, reason, message) {
  const host = request.get?.('host') ?? 'localhost';
  const protocol = request.protocol ?? 'http';
  const url = String(request.originalUrl ?? '').split('?')[0];
  return {
    status: code,
    type: 'application/json',
    body: javaJson({
      code,
      reason,
      url: `${protocol}://${host}${url}`,
      messages: [message],
      targets: null,
    }),
  };
}

/**
 * How many deep queries (an endpoint marked `deep`) may run at once. The
 * graph pool is 32 so that a few slow requests cannot hold every connection;
 * these routes can each run for the full read timeout and cost the database
 * the most, so they keep a smaller share. One past it is a 503 at once rather
 * than a wait, as the render service answers a full queue.
 */
export function deepShare(max) {
  let running = 0;
  return {
    enter: () => (running < max ? ((running += 1), true) : false),
    leave: () => {
      running = Math.max(0, running - 1);
    },
  };
}
