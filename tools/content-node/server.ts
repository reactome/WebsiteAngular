/**
 * The content service, in node: the server -- start-up, the path rules, the
 * download guard, failure answering, /health and warm-up. The endpoints are
 * the registry's (registry.ts), which assembles the families' lists (spec
 * 014); this module imports the registry and never a family.
 *
 * A gradual replacement for the Java ContentService's read surface. It exposes
 * the same paths under the same shapes, one endpoint at a time, and every one is
 * proven against the Java implementation by `diff.ts` before it is switched on
 * in `proxy.conf.js`.
 *
 * Deliberately not a rewrite in one go, and deliberately not the exporters:
 * SBML, SBGN and the PDF document come from Java libraries that carry those
 * specifications, and reimplementing them is a research project rather than a
 * port. Diagram figures already come from our own renderer.
 *
 *   NEO4J_USER=... NEO4J_PASSWORD=... npm run content:node
 *
 * Nothing points at it until a path is listed in proxy.conf.js, so running it
 * cannot affect the site.
 */
import express from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setInterval } from 'node:timers';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { configured, close } from './graph.ts';
import { settings } from './settings.ts';
import { defaultLabel, label, redirectLabel, setLabel } from './cache-label.ts';
import { solrConfigured } from './solr.ts';
import { asciiDigits, javaNumeric, javaTrim, javaTrimAll, present } from './java-text.ts';
import { pathId, rawSegment } from './spring.ts';
import { deepShare, javaError, javaJson, springNotFound, timedOut, unexpected } from './answers.ts';
import type { Failure } from './answers.ts';
import { databaseVersion } from './release.ts';
import { endpointFor, endpoints, getEndpointFor, refreshPsicquicResources } from './registry.ts';

// Node 24 has JSON.rawJSON (ES2025); TypeScript 5.9's libraries do not yet.
declare global {
  interface JSON {
    rawJSON(text: string): unknown;
  }
}

const PORT = settings.port();
const HOST = settings.host();

/** rfd-snapshot.json: the extensions Spring trusts (snapshot-rfd.ts). */
export interface RfdSnapshot {
  safe: string[];
}

/** rfd-snapshot.json's extensions, read on first use. */
let safeExtensions;

/**
 * Whether Java would mark this answer `Content-Disposition:
 * inline;filename=f.txt` -- Spring's guard against a reflected download
 * (AbstractMessageConverterMethodProcessor.addContentDispositionHeader), on
 * every body it writes but a redirect's. The request path's last segment is
 * percent-decoded and its extension -- after the last '.' -- checked. An
 * extension Spring does not trust (rfd-snapshot.json; snapshot-rfd.ts says
 * which it does) on either is marked: a versioned id, `R-HSA-69620.5`, as
 * much as `.exe`.
 */
export function downloadGuard(request) {
  const uri = present(String(request.originalUrl ?? '').split('?')[0]);
  const last = uri.slice(uri.lastIndexOf('/') + 1);
  safeExtensions ??= new Set(
    (
      JSON.parse(
        readFileSync(new URL('./rfd-snapshot.json', import.meta.url), 'utf8')
      ) as RfdSnapshot
    ).safe
  );
  const trusted = (text) => {
    let decoded = text;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      // Left as it came; Tomcat has refused a malformed escape before this.
    }
    const dot = decoded.lastIndexOf('.');
    if (dot === -1 || decoded.lastIndexOf('/') > dot) return true;
    const extension = decoded.slice(dot + 1);
    return javaTrimAll(extension) === '' || safeExtensions.has(extension.toLowerCase());
  };
  return !trusted(last);
}

/**
 * A failure Java answers in its own way, or undefined. A dbId past a long's
 * range: Java's Long.parseLong throws, naming the id as it read it (trimmed,
 * any version cut); Neo4j's toInteger refuses it the same way, which is how
 * this sees it -- on every endpoint, whatever its id rules.
 */
export function failureAnswer(request, path, failure) {
  const tooLong = timedOut(request, failure);
  if (tooLong) return tooLong;
  if (
    failure?.code !== 'Neo.ClientError.Statement.TypeError' ||
    !/is too large$/.test(failure.message)
  )
    return undefined;
  // Java names the text it failed to parse: the id (as read: trimmed, any
  // version cut), or a query parameter that was converted the same way, such
  // as /pathways/low/entity's species. Neo4j names the digits it was given.
  const refused = failure.message.match(/integer, (\S+), is too large$/)?.[1];
  const idAt = path.split('/').indexOf('{id}');
  const candidates = [
    ...(idAt < 0 ? [] : [javaTrim(pathId(rawSegment(request, idAt))).split('.')[0]]),
    ...[...new URLSearchParams(String(request.originalUrl ?? '').split('?')[1] ?? '').values()],
  ];
  const named = candidates.find((text) => {
    const trimmed = javaTrim(text);
    return javaNumeric(trimmed) && asciiDigits(trimmed).replace(/^0+(?=\d)/, '') === refused;
  });
  if (named === undefined && idAt < 0) return undefined;
  return javaError(
    request,
    500,
    'INTERNAL_SERVER_ERROR',
    `For input string: "${named ?? candidates[0] ?? refused}"`
  );
}

/**
 * The files /health's build fingerprint hashes: the service's modules and the
 * data it answers with (schema-snapshot.json), sorted by name, whether a module
 * is `.mjs` or `.ts` (spec 013: renamed, it would drop out of the hash unseen).
 * Specs excluded.
 * They ship in the image -- the Dockerfile copies the directory -- but they are
 * not what the service does, and a fingerprint that changes when a test is
 * edited reports a deployment difference that is not one. Caught by this very
 * endpoint: adding service.spec.mjs moved the hash without changing a line the
 * service runs.
 */
export function fingerprintFiles(names: string[]) {
  return names
    .filter((name) => /\.(mjs|ts|json)$/.test(name) && !/\.(spec\.(mjs|ts)|d\.ts)$/.test(name))
    .sort();
}

/**
 * A fingerprint of the code this process is actually running.
 *
 * The image bakes these modules in, so `docker compose build` is a separate act
 * from merging and nothing connected the two: a fix could be merged and not
 * deployed, or a container could be quietly ahead of main, and the only way to
 * tell was to read the source on disk -- which is the CLI's copy, not the
 * container's, and therefore always agrees with you.
 *
 * A content hash rather than a git sha, because a sha has to be passed in at
 * build time and anything that has to be remembered eventually is not. Compare
 * it against a checkout with
 * `LC_ALL=C ls tools/content-node/*.mjs tools/content-node/*.json | grep -v spec | xargs cat | sha256sum`,
 * taking the files sorted by name, as here. The JSON is schema-snapshot.json:
 * data the service answers with, so a regenerated snapshot is a different build.
 */
function buildId() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const names = fingerprintFiles(readdirSync(here));
    const hash = createHash('sha256');
    for (const name of names) hash.update(readFileSync(path.join(here, name)));
    return { build: hash.digest('hex').slice(0, 12), modules: names.length };
  } catch {
    // Never fail a health check over its own metadata.
    return { build: 'unknown', modules: 0 };
  }
}

const LATIN1_DISPOSITION = Symbol('latin1Disposition');

/**
 * Node reads a Content-Disposition value back as UTF-8 when the head goes
 * out with a body's bytes counted (nodejs/node#46528) -- so the Latin-1 byte
 * Tomcat writes for é became U+FFFD. Decided at end(), on the bytes Node is
 * given (a 304's '' and Express's bodiless HEAD are not converted, a HEAD's
 * Buffer is): then the value goes in as its UTF-8 bytes, and comes out é as
 * long as the head is written on its own, as Latin-1 -- which it is, because
 * Express hands end() a Buffer whenever it computes an ETag. Installed once
 * per response, so a second writeResult (an error after a first) does not
 * convert twice.
 */
function latin1Disposition(response) {
  if (response[LATIN1_DISPOSITION]) return;
  response[LATIN1_DISPOSITION] = true;
  const end = response.end.bind(response);
  response.end = (chunk, ...rest) => {
    const encoding = (typeof rest[0] === 'string' ? rest[0] : 'utf8') as BufferEncoding;
    const bytes =
      typeof chunk === 'string'
        ? Buffer.byteLength(chunk, encoding)
        : chunk && typeof chunk !== 'function'
          ? chunk.length
          : 0;
    const value = bytes > 0 && !response.headersSent && response.getHeader('Content-Disposition');
    if (typeof value === 'string')
      response.setHeader('Content-Disposition', Buffer.from(value, 'utf8').toString('latin1'));
    return end(chunk, ...rest);
  };
}

/**
 * A handler's answer on the wire. Objects go out as JSON written as Jackson
 * writes it (javaJson, not res.json's JSON.stringify); strings as they are, so
 * a text/plain endpoint is not quoted into JSON; a cached endpoint's body as it
 * was serialised once; and no body at all as nothing -- as Java sends when a
 * controller returns null, where send('') would add a text/html content type
 * Java does not.
 */
export function writeResult(response, result) {
  response.status(result.status);
  if (result.type) response.type(result.type);
  const body = result.body !== undefined || Boolean(result.serialised);
  for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
  latin1Disposition(response);
  const redirect = result.status >= 300 && result.status < 400;
  if (body && !redirect && response.req && downloadGuard(response.req))
    response.setHeader('Content-Disposition', 'inline;filename=f.txt');
  if (result.body === undefined && !result.serialised) response.end();
  else if (typeof result.body === 'string') response.send(result.body);
  // A figure's bytes, under the type the handler set.
  else if (Buffer.isBuffer(result.body)) response.end(result.body);
  else if (result.serialised) response.type('application/json').send(result.serialised);
  else response.type('application/json').send(javaJson(result.body));
}

/**
 * A POST's body, as the bytes that came: not inflated (Tomcat does not
 * inflate a request), and not refused for its type, which the handler checks
 * as Spring does. Past 10MB the rest is read and dropped and the handler
 * answers 413, where Java would read on; no client sends that many ids.
 */
function readBody(request, _response, next) {
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) request.tooLarge = true;
    else chunks.push(chunk);
  });
  request.on('end', () => {
    request.body = Buffer.concat(chunks);
    next();
  });
  request.on('error', next);
}

/** The /data/query/{id}/{attribute} names node answers, by their lower case. */
const QUERY_ATTRIBUTES = { stid: 'stId', normalpathway: 'normalPathway' };

export function app() {
  const server = express();
  server.disable('x-powered-by');
  // Spring matches a mapping's literal segments by case; Express, by
  // default, does not -- /search/icon/QUERY was the icon page here and an
  // icon id to Java.
  server.set('case sensitive routing', true);

  // Readable from any origin, as Java's ContentService is: pages on other sites
  // read it -- the embeddable diagram (spec 009) asks for the species list from
  // a partner's page. The ported endpoints matched Java's bodies byte for byte
  // and still broke that, by leaving this header out. On every answer, errors
  // included, so a page elsewhere can read that a request failed; and a
  // preflight is answered the way Java answers it.
  server.use('/ContentService', (request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    // Not stored at the edge unless an endpoint's answer says otherwise
    // (answer()): an error, a preflight or a path no endpoint answers is
    // never kept (spec 011).
    setLabel(response, defaultLabel(String(request.originalUrl)));
    if (request.method !== 'OPTIONS') return next();
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '1');
    response.sendStatus(200);
  });

  // Before any route, as Tomcat and Spring look at a path before any
  // controller does. A slash or backslash encoded, or a raw backslash, is Tomcat's 400 -- its page
  // names the server and its version, which this does not copy -- and so is
  // a '%' not followed by two hex digits, or an encoded NUL: Tomcat cannot
  // decode the path. Not undecodable UTF-8 (%FF), which Tomcat decodes to
  // U+FFFD, nor anything in the query. A doubled slash matches no mapping,
  // which is Spring's own 404.
  server.use('/ContentService', (request, response, next) => {
    const path = present(String(request.originalUrl).split('?')[0]);
    if (/%2f|%5c|\\|%(?![0-9A-Fa-f]{2})|%00/i.test(path))
      return response
        .status(400)
        .type('text/html')
        .send(
          '<!doctype html><html lang="en"><head><title>HTTP Status 400 – Bad Request</title></head><body><h1>HTTP Status 400 – Bad Request</h1></body></html>'
        );
    if (path.includes('//')) return writeResult(response, springNotFound(request));
    // A matrix parameter (`/data;jsessionid=x/diseases`) is no URL of ours:
    // Java ignores one, but nothing sends one on purpose, and every way of
    // writing a URL is one more to cache. Spring's 404, as for any path no
    // mapping matches (decided 18 Oct 2026, spec 006 T008). An encoded ';'
    // (%3B) is part of an id, as it is to Java.
    if (path.includes(';')) return writeResult(response, springNotFound(request));
    const [head, query] = String(request.url).split(/\?(.*)/s);
    const relative = present(head);
    // Tomcat decodes the path before Spring matches it, so /icon/qu%65ry is
    // /icon/query to Java. Routing here sees letters, digits, '-', '_' and
    // '~' decoded too -- all a literal segment holds -- and handlers still
    // read ids from the path as it came.
    const routed = relative
      .replace(/%([0-9A-Fa-f]{2})/g, (escape: string, hex: string) => {
        const char = String.fromCharCode(parseInt(hex, 16));
        return /[A-Za-z0-9_~-]/.test(char) ? char : escape;
      })
      // Java's /query/{id}/{attributeName} finds the attribute's getter
      // ignoring case (ControllerUtils.getProperty); node's two are literal
      // routes, so the attribute is put in their case, a trailing slash
      // kept. Not under Java's more specific /query/enhanced/{id} and
      // /query/abridged/{id}, where that segment is an id.
      .replace(
        /^(\/data\/query\/([^/]+)\/)([^/]+)(\/?)$/,
        (path: string, head: string, id: string, attribute: string, slash: string) => {
          const lower = attribute.toLowerCase();
          if (['enhanced', 'abridged'].includes(id) || !Object.hasOwn(QUERY_ATTRIBUTES, lower))
            return path;
          return head + QUERY_ATTRIBUTES[lower] + slash;
        }
      );
    // One URL per answer (spec 011): Java answers /x/ as /x, and the edge
    // would keep both. A GET or HEAD for an endpoint, slashed, is sent to
    // the URL without the slash -- the path and query as they came. Not
    // when that would not be the same request: a raw `#` would become a
    // fragment, a malformed escape would be re-encoded; those are answered
    // as before, and never stored.
    const sentUrl = String(request.originalUrl);
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      /.\/$/.test(routed) &&
      !sentUrl.includes('#') &&
      !/%(?![0-9A-Fa-f]{2})/.test(sentUrl)
    ) {
      const endpoint = getEndpointFor(`/ContentService${routed.slice(0, -1)}`);
      if (endpoint) {
        const [sent, sentQuery] = sentUrl.split(/\?(.*)/s);
        const location =
          present(sent).slice(0, -1) + (sentQuery === undefined ? '' : `?${sentQuery}`);
        setLabel(response, redirectLabel(location));
        return response.status(301).location(location).end();
      }
    }
    request.url = routed + (query === undefined ? '' : `?${query}`);
    next();
  });

  server.get('/health', async (_request, response) => {
    // The release this process is holding, which is the one thing here that can
    // be wrong without anything looking wrong. Caches live for the life of the
    // process by agreement -- updating the database includes restarting this --
    // and a missed restart shows up as diagram, figure and icon URLs pointing at
    // the previous release's bucket prefix, silently. Reporting it makes that
    // one curl away from obvious.
    //
    // Read through the same cache the endpoint uses, so this reports what is
    // being *served* rather than what the graph currently says. A health check
    // that went straight to the database would answer correctly while every
    // other response was stale, which is the opposite of useful.
    // Whatever the version endpoint's body is, written as it is.
    let release: unknown = null;
    try {
      const answer = await databaseVersion({ params: {}, query: {} });
      release = answer.body ?? null;
    } catch {
      // A health check that fails because the graph is down is reporting the
      // wrong thing: the process is up, and that is what this answers.
    }
    response.json({
      ok: true,
      ...buildId(),
      graph: configured(),
      solr: solrConfigured(),
      release,
      endpoints: endpoints.map((e) => e.path),
    });
  });

  for (const endpoint of endpoints) {
    // The table stores the Java path with {id}; express wants :id. Keeping one
    // string means the diff harness and proxy.conf.js can address an endpoint by
    // exactly what the Java service calls it.
    const route = endpoint.path.replace(/\{(\w+)\}/g, ':$1');
    // A POST's body arrives as bytes; its handler decodes them as Java would.
    const body = endpoint.method === 'post' ? [readBody] : [];
    // answerWith answers every failure of the handler's; a rejection past it
    // reaches the error handler below, which Express 5 waits for.
    server[endpoint.method ?? 'get'](route, ...body, (request, response) =>
      answerWith(endpoint, request, response)
    );
  }

  // Any other method on these paths is Java's 405: nginx sends every method
  // here, and Express's own answer was an HTML 404. After every route, so a
  // path two templates match is answered by the one that takes the method.
  for (const endpoint of endpoints) {
    server.all(endpoint.path.replace(/\{(\w+)\}/g, ':$1'), (request, response) =>
      writeResult(
        response,
        javaError(
          request,
          405,
          'METHOD_NOT_ALLOWED',
          `Request method '${request.method}' not supported`
        )
      )
    );
  }

  // A path no mapping matches is Spring's own 404 -- JSON, not Express's
  // HTML page. Since routing is by case, /data/database/VERSION is one.
  server.use('/ContentService', (request, response) =>
    writeResult(response, springNotFound(request))
  );

  // Express decodes route parameters before any handler runs, and a segment
  // that is not valid UTF-8 (%FF) made it answer its own HTML 400 -- a stack
  // trace, NODE_ENV being unset -- where Java decodes it to U+FFFD and answers
  // as usual. Handlers read the raw path (rawSegment), so the endpoint is run
  // regardless.
  server.use((failure, request, response, next) => {
    if (!(failure instanceof URIError) || response.headersSent) return next(failure);
    // The path as routing saw it, less a trailing slash, which Express
    // ignores too.
    const path = present(String(request.url).split('?')[0]).replace(/(.)\/$/, '$1');
    const endpoint = endpointFor(path);
    if (!endpoint) return next(failure);
    // HEAD is answered as GET, as Express answers it; any other method the
    // template does not take is Java's 405, as for a decodable id.
    const method = request.method === 'HEAD' ? 'get' : request.method.toLowerCase();
    if ((endpoint.method ?? 'get') !== method)
      return writeResult(
        response,
        javaError(
          request,
          405,
          'METHOD_NOT_ALLOWED',
          `Request method '${request.method}' not supported`
        )
      );
    const body = endpoint.method === 'post' ? readBody : (_request, _response, done) => done();
    body(request, response, () => answerWith(endpoint, request, response).catch(next));
  });

  // Anything else that reaches here is this service's failure: Java's
  // envelope, never Express's page with a stack trace in it.
  server.use((failure, request, response: express.Response, next: (failure: unknown) => void) => {
    // Begun already: Express ends the connection, as it must.
    if (response.headersSent) return next(failure);
    console.error(`${request.path}: ${failure?.message}`);
    writeResult(response, unexpected(request));
  });

  return server;
}

/** DEEP_QUERY_LIMIT when it is a whole number from 1 to 32 (the pool's default); otherwise 4. */
export function deepLimit(setting) {
  const limit = Number(setting);
  return Number.isInteger(limit) && limit >= 1 && limit <= 32 ? limit : 4;
}

const DEEP = deepShare(deepLimit(settings.deepQueryLimit()));

/**
 * One endpoint's answer to one request: its handler's result, or what a
 * failure means in Java's terms, never a stack trace.
 */
async function answerWith(endpoint, request, response) {
  if (endpoint.deep) {
    if (!DEEP.enter())
      return writeResult(response, {
        ...javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly'),
        headers: { 'Retry-After': '5' },
      });
    try {
      return await answer(endpoint, request, response);
    } finally {
      DEEP.leave();
    }
  }
  return answer(endpoint, request, response);
}

export async function answer(endpoint, request, response) {
  // The answer's caching label, from the request exactly as it was sent:
  // request.url has been rewritten for routing by now (spec 011).
  const write = (result) => {
    setLabel(
      response,
      label({
        method: request.method,
        endpoint: endpoint.path,
        originalUrl: String(request.originalUrl ?? ''),
        status: result.status,
      })
    );
    writeResult(response, result);
  };
  try {
    write(await endpoint.handler(request));
  } catch (caught) {
    const failure = caught as Failure;
    const answer = failureAnswer(request, endpoint.path, failure);
    if (answer) return write(answer);
    // The message, not a stack: this stands in for a service whose errors
    // reach real clients.
    console.error(`${endpoint.path}: ${failure.message}`);
    write({ status: 500, type: 'text/plain', body: 'content service error' });
  }
}

/**
 * Whether Node was started with this file, whatever it is called: the test
 * was `endsWith('service.mjs')`, which a service renamed to `.ts` (spec 013)
 * fails, so it would load, never listen, and exit 0 -- a restart loop in its
 * container. Compared after symlinks are resolved, as Node resolves its own.
 * scripts/is-entry.mjs does the same for the scripts, but the service images
 * ship only this directory.
 */
function startedDirectly() {
  const started = process.argv[1];
  try {
    return !!started && realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Started directly rather than imported by a test.
if (startedDirectly()) {
  const server = app().listen(PORT, HOST, () => {
    console.log(`content-node listening on http://${HOST}:${PORT}`);
    // Warm the cached endpoints the way Java's @PostConstruct does, so the
    // first reader does not pay the four seconds. Failures are left to the
    // request path, which retries: warming must not be the thing that decides
    // whether the service can answer.
    // The PSICQUIC services, read now and every five minutes, as Java's
    // scheduler does.
    // A mistake of ours is logged, not left to end the process.
    const refresh = () =>
      void refreshPsicquicResources().catch((error) =>
        console.error(`PSICQUIC resources: ${error.stack}`)
      );
    refresh();
    setInterval(refresh, 5 * 60 * 1000).unref();
    for (const endpoint of endpoints) {
      if (!endpoint.handler.warms) continue;
      // A warmed handler is a cached one, which reads nothing of its request.
      Promise.resolve(endpoint.handler({ params: {} })).catch((error) =>
        console.error(`warming ${endpoint.path}: ${error.message}`)
      );
    }
    console.log(
      `  graph credentials: ${configured() ? 'present' : 'MISSING (set NEO4J_USER/PASSWORD)'}`
    );
    console.log(
      `  solr: ${solrConfigured() ? 'configured' : 'MISSING (set SOLR_URL/USER/PASSWORD)'}`
    );
    console.log(`  endpoints: ${endpoints.length}`);
  });
  const stop = async () => {
    server.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
