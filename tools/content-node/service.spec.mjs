// @vitest-environment node
//
// What can be checked without a database.
//
// This service had no handler-level test at all, which is the gap that let a
// `ReferenceError` reach the render service's first request and pass every
// gate. content-node is the one answering beta's traffic, so it had the same
// hole with more at stake.
//
// Most endpoints need Neo4j and belong to `diff.ts`, which compares them
// against Java. What is checkable here is everything that is *not* a query: the
// endpoint table's own integrity, and the pure functions a declared difference
// is built from.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { app, fingerprintFiles, failureAnswer, writeResult, deepLimit } from './server.ts';
import { endpoints, endpointFor } from './registry.ts';
import {
  PathwayBrowserNode,
  eventProjection,
  inDepthAttributes,
  javaUrlDecode,
  locationsInPathwayBrowser,
  locationsQuery,
  parseHierarchy,
  pathwayBrowserJson,
  topPathwayJson,
  topSpeciesMatch,
} from './pathways-events-endpoints.ts';
import { databaseObjectTsv, needsIncoming } from './data-query-endpoints.ts';
import { deepShare } from './answers.ts';
import { participantJson, participantsFrom, physicalEntityJson } from './entities-endpoints.ts';
import {
  schemaCountQuery,
  schemaMinQuery,
  schemaModelQuery,
  schemaWindow,
  simpleObjectJson,
} from './schema-endpoints.ts';
import { personWhere } from './person-endpoints.ts';
import { referenceEntityJson } from './reference-entities.ts';
import { inDepthId, pathwayJson, resolveId, speciesFilter } from './objects.ts';
import { javaError, javaJson, neo4jFailureMessage, notFound, timedOut } from './answers.ts';
import {
  pathId,
  servletParameter,
  springBoolean,
  springIntWithDefault,
  springInteger,
  springPrimitiveBoolean,
  writerFor,
} from './spring.ts';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('/health', () => {
  it('answers, which nothing checked before', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.endpoints.length).toBe(endpoints.length);
  });

  it('says which code is running, so a stale container can be spotted', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.build).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('the endpoint table', () => {
  it('addresses every endpoint by the path Java calls it', () => {
    // The table is read by the diff harness and by proxy.conf.js, so a path
    // that does not match Java's is a comparison against the wrong thing.
    for (const endpoint of endpoints) {
      expect(endpoint.path, `${endpoint.path} is a ContentService path`).toMatch(
        /^\/ContentService\//
      );
      expect(typeof endpoint.handler, `${endpoint.path} has a handler`).toBe('function');
    }
  });

  it('declares differences as patterns, never as loose strings', () => {
    // `differs` entries are tested with `.test`, so a string here would throw
    // at comparison time rather than at load -- during a diff run, which is
    // exactly when the harness needs to be trustworthy.
    for (const endpoint of endpoints) {
      for (const rule of endpoint.differs ?? []) {
        expect(rule, `${endpoint.path} declares a RegExp`).toBeInstanceOf(RegExp);
      }
    }
  });

  it('gives every unordered endpoint a key, and every normalise a function', () => {
    for (const endpoint of endpoints) {
      if ('unordered' in endpoint) expect(typeof endpoint.unordered).toBe('function');
      if ('normalise' in endpoint) expect(typeof endpoint.normalise).toBe('function');
    }
  });
});

describe("the person lists' declared difference", () => {
  const person = endpoints.find((e) => e.path.endsWith('/authoredReactions'));

  it('keeps the first occurrence and drops later ones', () => {
    // Java returns an event once per authorship edit. The page asks what a
    // person authored, not when they edited it, so the event belongs once --
    // and first-occurrence in Java's descending order means the row that stays
    // is the one that was already there, in the position it was already in.
    const java = [
      { dbId: 1, dateTime: '2026-01-01' },
      { dbId: 2, dateTime: '2025-01-01' },
      { dbId: 1, dateTime: '2013-01-01' },
      { dbId: 3, dateTime: '2012-01-01' },
    ];
    expect(person.normalise(java)).toEqual([
      { dbId: 1, dateTime: '2026-01-01' },
      { dbId: 2, dateTime: '2025-01-01' },
      { dbId: 3, dateTime: '2012-01-01' },
    ]);
  });

  it('leaves a list with no duplicates exactly as it was', () => {
    const java = [{ dbId: 1 }, { dbId: 2 }, { dbId: 3 }];
    expect(person.normalise(java)).toEqual(java);
  });

  it('is declared, so the harness reports it rather than hiding it', () => {
    expect(person.differs?.length, 'the normalisation is declared').toBeGreaterThan(0);
  });
});

describe('the species lists', () => {
  const paths = endpoints.map((e) => e.path);

  it('serves both, on the paths Java uses', () => {
    expect(paths).toContain('/ContentService/data/species/main');
    expect(paths).toContain('/ContentService/data/species/all');
  });

  it('serves them as two entries rather than one taking a flag', () => {
    // The two differ in order as well as contents -- `main` pins Homo sapiens
    // first, `all` is plain alphabetical including human in its place -- and a
    // single handler with a boolean is how one of those silently acquires the
    // other's sort. Both orders are proven against Java by `diff.ts`, which
    // needs a database and so cannot run here; what this can hold is that they
    // stayed separate.
    const species = endpoints.filter((e) => e.path.includes('/data/species/'));
    expect(species).toHaveLength(2);
    expect(species[0].handler).not.toBe(species[1].handler);
  });
});

describe('what /health says about staleness', () => {
  /**
   * Caches live for the life of the process by agreement: updating the database
   * includes restarting this service. The previous version of that reasoning
   * was an inference — "a release restarts the service", true of Java's WAR and
   * not of a container with `restart: unless-stopped` — so the rule is now the
   * rule, and this is what makes a missed restart visible.
   *
   * It matters because the release number keys the bucket paths for diagrams,
   * figures and icons: a process holding the previous one sends all of those to
   * the wrong prefix, and nothing else about the response looks wrong.
   */
  it('reports the release it is serving', async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toHaveProperty('release');
  });

  it('still answers when the graph cannot be reached', async () => {
    // No credentials in this suite, so the version handler throws. A health
    // check that failed on that would be reporting the database's health under
    // the name of the process's.
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});

describe('cross-origin reads', () => {
  // Java answers every ContentService request with Access-Control-Allow-Origin:
  // *, and pages on other sites rely on it -- the embeddable diagram (spec 009)
  // reads the species list from a partner's page. The ported endpoints matched
  // Java byte for byte and still broke it, by leaving the header out: the
  // browser refused the answer before anyone saw the body.
  const path = '/ContentService/data/species/main';

  it('allows any origin to read an answer, a failure included', async () => {
    const response = await fetch(`${base}${path}`, { headers: { Origin: 'https://example.org' } });
    // No database here, so this is the error path: a partner's page has to be
    // able to read that it failed, as well as what it got.
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers a preflight the way Java does', async () => {
    const response = await fetch(`${base}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.org',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('covers every ported endpoint', async () => {
    // In parallel: with no database here, each one takes a while to fail.
    const origins = await Promise.all(
      endpoints.map(async (endpoint) => {
        const url = `${base}${endpoint.path.replace(/\{(\w+)\}/g, 'R-HSA-69620')}`;
        const response = await fetch(url, { headers: { Origin: 'https://example.org' } });
        await response.arrayBuffer();
        return [endpoint.path, response.headers.get('access-control-allow-origin')];
      })
    );
    expect(origins.filter(([, origin]) => origin !== '*')).toEqual([]);
  }, 30_000);
});

describe('an id that is not valid UTF-8', () => {
  it('decodes as Tomcat does: a malformed sequence is U+FFFD', () => {
    expect(pathId('%FF')).toBe('\ufffd');
    expect(pathId('%E2%82')).toBe('\ufffd');
    expect(pathId('%C3%A9x')).toBe('éx');
  });

  it("reaches the handler, and gets Java's answer rather than Express's HTML 400", async () => {
    // Express decodes route parameters before any handler runs and failed on
    // these, answering with its own page -- a stack trace, NODE_ENV unset.
    // Measured: Java's person/%FF is this 404.
    const response = await fetch(`${base}/ContentService/data/person/%FF`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).messages).toEqual(['No person found for id: \ufffd']);
  });

  it('decodes an encoded surrogate as one U+FFFD, as the JDK does', () => {
    // Measured: Java's person/%ED%A0%80 names one; the WHATWG decoder makes three.
    expect(pathId('%ED%A0%80')).toBe('\ufffd');
  });

  it("answers every method and path form as the template's own route would", async () => {
    // HEAD is GET's; a method the template does not take is Java's 405; a
    // trailing slash changes nothing. Each was a 500 from the decode-failure path (review of #480).
    const at = (path, method = 'GET') => fetch(`${base}/ContentService/data${path}`, { method });
    expect((await at('/person/%FF', 'HEAD')).status).toBe(404);
    expect((await at('/person/%FF', 'POST')).status).toBe(405);
    expect((await at('/orthologies/ids/species/%FF')).status).toBe(405);
    expect((await at('/person/%FF/')).status).toBe(404);
  });

  it('never answers with a stack trace', async () => {
    const response = await fetch(`${base}/ContentService/data/query/%FF/normalPathway`);
    expect(await response.text()).not.toContain('at ');
  });
});

describe('/pathways/low/entity reads its species as the servlet does', () => {
  it('takes no meaning from brackets in a parameter name, as Spring takes none', async () => {
    // Express's default query parser made species[x]=1 an object -- "in
    // [object Object]" -- and species[]=9606 a filter Java never applies.
    // Measured: Java's message is "in null".
    const response = await fetch(
      `${base}/ContentService/data/pathways/low/entity/XYZ?species%5Bx%5D=1`
    );
    expect((await response.json()).messages).toEqual(['No result for XYZ in null']);
  });
});

describe('the deep queries, held to their own share of the graph', () => {
  // The pool grew from 8 to 32 so that a few slow requests cannot hold every
  // connection; these routes -- a whole tree below an object, or every route
  // up to a diagram -- are the ones that can run for the full read timeout,
  // so they keep a smaller share of their own.
  it('marks the in-depth and locationsInPWB routes as deep', () => {
    // As a set: which is listed first is the order between families (R3).
    const deep = endpoints.filter((endpoint) => endpoint.deep).map((endpoint) => endpoint.path);
    expect(deep.sort()).toEqual([
      '/ContentService/data/detail/{id}/locationsInPWB',
      '/ContentService/data/entity/{id}/in-depth',
      '/ContentService/data/event/{id}/in-depth',
    ]);
  });

  it('takes DEEP_QUERY_LIMIT only as a whole number from 1 to 32, and 4 otherwise', () => {
    // -1 refused every deep request for good; 2.5 let three run.
    expect(deepLimit('8')).toBe(8);
    for (const setting of [undefined, '', '-1', '0', '2.5', 'many', '100']) {
      expect(deepLimit(setting), String(setting)).toBe(4);
    }
  });

  it('lets four run at once and refuses the fifth', () => {
    const share = deepShare(4);
    expect([1, 2, 3, 4].map(() => share.enter())).toEqual([true, true, true, true]);
    expect(share.enter()).toBe(false);
    share.leave();
    expect(share.enter()).toBe(true);
  });
});

describe('a pool with no connection free', () => {
  it('is a 503 in the envelope, not a bare 500', () => {
    // neo4j-driver's newError gives this one no code, only its message: it
    // reached the generic 500 'content service error' (review, 16 Oct 2026).
    const failure = Object.assign(
      new Error(
        'Connection acquisition timed out in 10000 ms. Pool status: Active conn count = 32, Idle conn count = 0.'
      ),
      { code: 'N/A' }
    );
    const answer = timedOut({ originalUrl: '/ContentService/data/query/R-HSA-69620' }, failure);
    expect(answer?.status).toBe(503);
    expect(JSON.parse(answer.body).messages[0]).toContain('busy');
  });
});

describe('a query past its time limit', () => {
  it('is a 503 in the envelope, so the database is not held for one request', () => {
    const failure = Object.assign(new Error('The transaction has been terminated.'), {
      code: 'Neo.ClientError.Transaction.TransactionTimedOut',
    });
    const answer = timedOut(
      { originalUrl: '/ContentService/data/event/R-HSA-162582/in-depth?maxDepth=-1' },
      failure
    );
    expect(answer?.status).toBe(503);
    expect(JSON.parse(answer.body)).toMatchObject({ code: 503, reason: 'SERVICE_UNAVAILABLE' });
    expect(timedOut({ originalUrl: '/x' }, new Error('boom'))).toBe(undefined);
  });

  // The same answer for the database ending a query any other way: a
  // transaction it terminated, or one that reached its memory limit -- what
  // ran it out of memory on 15 Oct 2026.
  for (const code of [
    'Neo.ClientError.Transaction.Terminated',
    'Neo.TransientError.Transaction.Terminated',
    'Neo.TransientError.General.TransactionMemoryLimit',
    'Neo.TransientError.General.MemoryPoolOutOfMemoryError',
    // The database itself out of memory, or not there at all.
    'Neo.TransientError.General.OutOfMemoryError',
    'Neo.TransientError.Database.DatabaseUnavailable',
    'ServiceUnavailable',
    'SessionExpired',
  ]) {
    it(`is a 503 for ${code} too`, () => {
      const failure = Object.assign(new Error('ended'), { code });
      expect(timedOut({ originalUrl: '/x' }, failure)?.status).toBe(503);
    });
  }

  it('leaves other failures alone', () => {
    const failure = Object.assign(new Error('bad'), {
      code: 'Neo.ClientError.Statement.SyntaxError',
    });
    expect(timedOut({ originalUrl: '/x' }, failure)).toBe(undefined);
  });
});

describe('the edges of a path, answered as Tomcat and Spring answer them', () => {
  // Each measured against Java, 15 Oct 2026, on every endpoint node serves.
  const springNotFound = async (path) => {
    const response = await fetch(base + path);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['timestamp', 'status', 'error', 'path']);
    expect(body).toMatchObject({ status: 404, error: 'Not Found', path });
    expect(Number.isInteger(body.timestamp)).toBe(true);
  };

  it("answers a matrix parameter, on an id or any other segment, with Spring's own 404", async () => {
    // Java would drop it and answer; we do not take one (spec 006 T008).
    await springNotFound('/ContentService/data/query/;x');
    await springNotFound('/ContentService/data/person/;x/publications');
    await springNotFound('/ContentService/data/;x/query/R-HSA-70486/stId');
    await springNotFound('/ContentService/data/query;x/R-HSA-70486/stId');
  });

  it("answers a doubled slash with Spring's own 404", async () => {
    await springNotFound('/ContentService/data/query//R-HSA-109606');
    await springNotFound('/ContentService/data/event//R-HSA-69620/ancestors');
  });

  it("answers a raw backslash with Tomcat's 400, as an encoded one", async () => {
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const url = new URL(base);
      const call = request(
        { host: url.hostname, port: url.port, path: '/ContentService/data/query/R-HSA-1\\x' },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        }
      );
      call.on('error', reject);
      call.end();
    });
    expect(status).toBe(400);
  });

  it("answers an encoded slash or backslash with Tomcat's 400, naming no server", async () => {
    for (const path of [
      '/ContentService/data/query/R-HSA-1%2Fx',
      '/ContentService/data/query/R-HSA-1%5cx',
    ]) {
      const response = await fetch(base + path);
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toMatch(/^text\/html/);
      expect(await response.text()).not.toMatch(/tomcat|apache/i);
    }
  });

  it("answers a malformed escape or an encoded NUL in the path with Tomcat's 400", async () => {
    // Tomcat refuses these before Spring sees the path (measured 22 Oct
    // 2026): a '%' not followed by two hex digits, and %00.
    for (const path of [
      '/ContentService/data/query/R-HSA-%E0%A4%A',
      '/ContentService/data/query/%',
      '/ContentService/data/query/R-HSA-69620/%zz',
      '/ContentService/data/query/R-HSA-%G1',
      '/ContentService/data/query/R-HSA-%00',
    ]) {
      const response = await fetch(base + path);
      expect([path, response.status]).toEqual([path, 400]);
      expect(response.headers.get('content-type')).toMatch(/^text\/html/);
      expect(await response.text()).not.toMatch(/tomcat|apache/i);
    }
  });

  it('leaves an escape Tomcat decodes, and any in the query, to the endpoint', async () => {
    // %FF is not UTF-8, but Tomcat decodes it (to U+FFFD) and Java answers as
    // usual; the query string is the endpoint's to read.
    for (const path of [
      '/ContentService/data/query/R-HSA-%FF',
      '/ContentService/data/query/R-HSA-69620/%25',
      '/ContentService/search/query?query=%zz',
    ]) {
      // No graph here, so the endpoint's own answer is a failure; what
      // matters is that it is the endpoint's, not Tomcat's page.
      const response = await fetch(base + path);
      expect([path, response.headers.get('content-type')]).not.toEqual([
        path,
        expect.stringMatching(/^text\/html/),
      ]);
    }
  });

  it("answers a dbId beyond a long's range with Java's 500, naming the id as given", () => {
    const failure = Object.assign(new Error('integer, 99999999999999999999, is too large'), {
      code: 'Neo.ClientError.Statement.TypeError',
    });
    const request = { originalUrl: '/ContentService/data/query/%2099999999999999999999.3%20' };
    const answer = failureAnswer(request, '/ContentService/data/query/{id}', failure);
    expect(answer?.status).toBe(500);
    expect(JSON.parse(answer.body)).toMatchObject({
      code: 500,
      reason: 'INTERNAL_SERVER_ERROR',
      messages: ['For input string: "99999999999999999999"'],
    });
    // The number Neo4j refused may be a query parameter's, not the id's:
    // Java names what it failed to parse.
    const species = {
      originalUrl:
        '/ContentService/data/pathways/low/entity/R-HSA-199420?species=99999999999999999999',
    };
    expect(
      JSON.parse(
        failureAnswer(species, '/ContentService/data/pathways/low/entity/{id}', failure).body
      ).messages
    ).toEqual(['For input string: "99999999999999999999"']);
    // Any other failure is not Java's to mirror.
    expect(failureAnswer(request, '/ContentService/data/query/{id}', new Error('boom'))).toBe(
      undefined
    );
  });
});

describe('/query/enhanced/{id} ranks above /query/{id}/{attribute}, as in Spring', () => {
  it('reads /query/enhanced/stId as the enhanced object with the id stId', async () => {
    const response = await fetch(`${base}/ContentService/data/query/enhanced/stId`);
    expect(response.status).toBe(404);
    expect((await response.json()).messages).toEqual(['Id: stId has not been found in the System']);
  });
});

describe("needsIncoming, QueryObjectController's needsIncomingRelationship", () => {
  // The branches that need no graph; measured against Java's /query/enhanced.
  it('wants them for a stable id, except a chemical', async () => {
    expect(await needsIncoming('R-HSA-70486')).toBe(true);
    expect(await needsIncoming('REACT_432')).toBe(true);
    expect(await needsIncoming('R-ALL-113592')).toBe(false);
    expect(await needsIncoming('chebi:15422')).toBe(false);
  });

  it("does not for what Long.valueOf refuses: padding, words, a long's overflow", async () => {
    expect(await needsIncoming(' 70486')).toBe(false);
    expect(await needsIncoming('foo')).toBe(false);
    expect(await needsIncoming('99999999999999999999')).toBe(false);
  });
});

describe('springPrimitiveBoolean, a boolean with a default as Spring reads it', () => {
  // Measured against Java's /query/enhanced/v2, 15 Oct 2026.
  it('takes the default for absent or empty, and reads the words Spring knows', () => {
    expect(springPrimitiveBoolean([], true)).toEqual({ value: true });
    expect(springPrimitiveBoolean([''], false)).toEqual({ value: false });
    expect(springPrimitiveBoolean(['TRUE'], false)).toEqual({ value: true });
    expect(springPrimitiveBoolean(['off'], true)).toEqual({ value: false });
  });

  it("is Spring's 400 for blank or anything else, naming boolean", () => {
    expect(springPrimitiveBoolean([' '], true).error).toBe(
      "Failed to convert value of type 'java.lang.String' to required type 'boolean'; " +
        'nested exception is java.lang.IllegalArgumentException: Invalid boolean value [ ]'
    );
    expect(springPrimitiveBoolean(['x', 'y'], true).error).toMatch(/String\[\]' .*\[x,y\]$/);
    // Only a single empty value is the default; repeated, the first being
    // empty, Spring converts the array and fails (review of #476).
    expect(springPrimitiveBoolean(['', 'true'], false).error).toMatch(/String\[\]' .*\[,true\]$/);
    expect(springPrimitiveBoolean(['', ''], false).error).toMatch(/\[,\]$/);
  });
});

describe('the in-depth parameters, as the in-depth controllers read them', () => {
  // Each measured against Java's /data/entity/{id}/in-depth, 15 Oct 2026.
  it('reads maxDepth as a primitive int with a default', () => {
    expect(springIntWithDefault([], 1)).toEqual({ value: 1 });
    expect(springIntWithDefault([''], 1)).toEqual({ value: 1 });
    expect(springIntWithDefault(['0x2'], 1)).toEqual({ value: 2 });
    expect(springIntWithDefault(['1', '2'], 1)).toEqual({ value: 1 });
    expect(springIntWithDefault(['', '2'], 1).error).toBe(
      "Failed to convert value of type 'java.lang.String[]' to required type 'int'; " +
        'nested exception is java.lang.NumberFormatException: For input string: ",2"'
    );
    expect(springIntWithDefault(['x'], 1).error).toBe(
      "Failed to convert value of type 'java.lang.String' to required type 'int'; " +
        'nested exception is java.lang.NumberFormatException: For input string: "x"'
    );
    expect(springIntWithDefault([' '], 1).error).toMatch(/For input string: ""$/);
    expect(springIntWithDefault(['99999999999'], 1).error).toMatch(
      /For input string: "99999999999"$/
    );
  });

  it('reads attributes as Java joins and splits them, and refuses anything but type names', () => {
    expect(inDepthAttributes([])).toEqual({ value: 'species|compartment' });
    expect(inDepthAttributes([''])).toEqual({ value: 'species|compartment' });
    expect(inDepthAttributes(['species,'])).toEqual({ value: 'species' });
    expect(inDepthAttributes(['species', 'compartment'])).toEqual({ value: 'species|compartment' });
    expect(inDepthAttributes([','])).toEqual({ value: 'species' });
    expect(inDepthAttributes(['foo-bar']).error).toBeDefined();
    expect(inDepthAttributes(['species]->(x) DETACH DELETE x //']).error).toBeDefined();
  });

  it('reads an id as getIdentifier, isStId and isDbId do', () => {
    expect(inDepthId('R-HSA-109796.2')).toEqual({ idType: 'stId', id: 'R-HSA-109796' });
    expect(inDepthId(' 109796 ')).toEqual({ idType: 'dbId', id: '109796' });
    expect(inDepthId('UniProt:P01112.2')).toEqual({ idType: 'stId', id: 'UniProt:P01112.2' });
    // getIdentifier translates a pre-2016 REACT_ id to the stable id it became.
    expect(inDepthId('REACT_6542.3')).toEqual({ idType: 'oldStId', id: 'REACT_6542' });
    expect(inDepthId('foo')).toBeUndefined();
  });
});

describe("personWhere, as graph-core's PersonService reads a person's id", () => {
  // Measured against Java's /data/person/{id} and /publications, 15 Oct 2026.
  it("reads digits as a dbId, any script's, matched under the indexed label", () => {
    expect(personWhere('1169272')).toEqual({
      anchor: 'n:DatabaseObject',
      where: 'n.dbId = toInteger($id) AND n:Person',
      params: { id: '1169272' },
    });
    expect(personWhere('\u0661\u0662')?.params).toEqual({ id: '12' });
  });

  it('reads an ORCID by its pattern, with ASCII digits and a final X allowed', () => {
    expect(personWhere('0000-0002-3218-5631')?.where).toBe('n.orcidId = $id');
    expect(personWhere('0000-0002-1825-009X')?.where).toBe('n.orcidId = $id');
    expect(personWhere('0000-0002-3218-563')).toBeUndefined();
  });

  it('does not trim: a padded dbId is no id at all, as in Java', () => {
    expect(personWhere(' 1169272')).toBeUndefined();
  });

  it('reads an e-mail address only for publications', () => {
    expect(personWhere('x@example.org')).toBeUndefined();
    expect(personWhere('x@example.org', { email: true })?.where).toBe('n.eMailAddress = $id');
    expect(personWhere('x@example.ORG', { email: true })).toBeUndefined();
  });
});

describe("writerFor, Java's view and identity for a request", () => {
  const writer = (query) => writerFor({ originalUrl: `/ContentService/data/query/1${query}` });
  // CustomMessageConverter.getObjectWriter, measured against Java 15 Oct 2026.
  for (const [query, view, jsog] of [
    ['', 1, false],
    ['?view=nested', 2, false],
    ['?view=nested-aggregated', 4, false],
    ['?view=flatten', 1, false],
    ['?view=NESTED', 1, false],
    ['?view=nested&view=nested-aggregated', 2, false],
    ['?includeRef=true', 1, true],
    ['?includeRef=TRUE&view=nested', 2, true],
    ['?includeRef=yes', 1, false],
    ['?includeRef=false&includeRef=true', 1, false],
  ]) {
    it(`reads ${JSON.stringify(query)} as view ${view}${jsog ? ' with JSOG' : ''}`, () => {
      expect(writer(query)).toEqual([view, { jsog }]);
    });
  }
});

describe('databaseObjectTsv, as ControllerUtils.toTSV writes an object', () => {
  // Measured against Java's /data/query/R-HSA-6802957/normalPathway, 15 Oct 2026.
  it('writes the stable id, the name and the class, tab-separated, no newline', () => {
    expect(
      databaseObjectTsv({
        dbId: 5673001,
        stId: 'R-HSA-5673001',
        displayName: 'RAF/MAP kinase cascade',
        schemaClass: 'Pathway',
      })
    ).toBe('R-HSA-5673001\tRAF/MAP kinase cascade\tPathway');
  });

  it('writes the dbId when there is no stable id, or an empty one', () => {
    expect(
      databaseObjectTsv({ dbId: 48887, displayName: 'Homo sapiens', schemaClass: 'Species' })
    ).toBe('48887\tHomo sapiens\tSpecies');
    expect(databaseObjectTsv({ dbId: 1, stId: '', displayName: 'x', schemaClass: 'Pathway' })).toBe(
      '1\tx\tPathway'
    );
  });

  it('writes a missing name as Java concatenates it: null', () => {
    expect(databaseObjectTsv({ dbId: 1, stId: 'R-HSA-1', schemaClass: 'Pathway' })).toBe(
      'R-HSA-1\tnull\tPathway'
    );
  });
});

describe('resolveId, as graph-core reads an id', () => {
  // Each form measured against Java's /data/query/{id}/stId, 13 Oct 2026.
  const cases = [
    ['70486', 'n.dbId = toInteger($id)', '70486'],
    ['0070486', 'n.dbId = toInteger($id)', '0070486'],
    ['70486.3', 'n.dbId = toInteger($id)', '70486'],
    ['R-HSA-70486', 'n.stId = $id', 'R-HSA-70486'],
    ['R-HSA-70486.4', 'n.stId = $id', 'R-HSA-70486'],
    [' R-HSA-70486 ', 'n.stId = $id', 'R-HSA-70486'],
    ['REACT_1081.3', 'n.oldStId = $id', 'REACT_1081'],
    // A reference id keeps its dot: only ids without ':' are cut.
    ['UniProt:P04637.2', 'n.stId = $id', 'UniProt:P04637.2'],
    ['Rfoo', 'n.stId = $id', 'Rfoo'],
    // Java's trim takes every character up to U+0020, control characters too,
    ['\u000170486\u001f', 'n.dbId = toInteger($id)', '70486'],
    // and its isNumeric and parseLong take any script's digits.
    ['\u0667\u0660\u0664\u0668\u0666', 'n.dbId = toInteger($id)', '70486'],
    ['\uff17\uff10\uff14\uff18\uff16', 'n.dbId = toInteger($id)', '70486'],
  ];
  for (const [raw, where, id] of cases) {
    it(`reads ${JSON.stringify(raw)} as Java does`, () => {
      expect(resolveId(raw)).toEqual({ where, params: { id } });
    });
  }

  it('reads digits from outside the BMP as Java does: not a number', () => {
    // Java tests each UTF-16 unit; a surrogate pair is never a digit to it.
    expect(resolveId('\u{1D7CF}\u{1D7CF}\u{1D7D1}').where).toBe('false');
  });

  it('matches nothing for an id Java would not find, lower case included', () => {
    // Java's trim leaves a no-break space or a line separator in place.
    for (const raw of ['abc', 'r-hsa-70486', '', '\u00a070486', '\u202870486']) {
      expect(resolveId(raw).where).toBe('false');
    }
  });
});

describe('pathId, the id as Spring hands it to a controller', () => {
  it('keeps an encoded semicolon, which Spring decodes only after', () => {
    expect(pathId('R-HSA-70486%3Bx')).toBe('R-HSA-70486;x');
  });

  it('decodes the rest, spaces included', () => {
    expect(pathId('%20R-HSA-70486%20')).toBe(' R-HSA-70486 ');
  });
});

describe("eventProjection, graph-core's EventProjection as Java writes it", () => {
  // A reaction's node as the graph holds it; Java's answer for R-HSA-5672965,
  // 13 Oct 2026, is the expected value.
  const reaction = {
    schemaClass: 'Reaction',
    isInferred: false,
    category: 'transition',
    stIdVersion: 'R-HSA-5672965.4',
    releaseDate: '2015-06-17',
    displayName: 'RAS GEFs promote RAS nucleotide exchange',
    speciesName: 'Homo sapiens',
    stId: 'R-HSA-5672965',
    name: ['RAS GEFs promote RAS nucleotide exchange'],
    dbId: 5672965,
    isInDisease: false,
    // Not part of the projection: never written.
    isChimeric: false,
  };

  it("writes Java's keys in Java's order", () => {
    expect(JSON.stringify(eventProjection(reaction))).toBe(
      '{"dbId":5672965,"displayName":"RAS GEFs promote RAS nucleotide exchange",' +
        '"stId":"R-HSA-5672965","name":["RAS GEFs promote RAS nucleotide exchange"],' +
        '"stIdVersion":"R-HSA-5672965.4","schemaClass":"Reaction","speciesName":"Homo sapiens",' +
        '"releaseDate":"2015-06-17","hasDiagram":false,"hasEHLD":false,"diagramWidth":0,' +
        '"diagramHeight":0,"category":"transition","inferred":false,"inDisease":false}'
    );
  });

  it('puts isCanonical and definition with the field-backed properties, before inferred', () => {
    const keys = Object.keys(eventProjection({ ...reaction, isCanonical: 'x', definition: 'y' }));
    expect(keys.slice(-5)).toEqual([
      'category',
      'isCanonical',
      'definition',
      'inferred',
      'inDisease',
    ]);
  });

  it('defaults the flags and the diagram size as the projection does', () => {
    expect(eventProjection({ dbId: 1 })).toEqual({
      dbId: 1,
      hasDiagram: false,
      hasEHLD: false,
      diagramWidth: 0,
      diagramHeight: 0,
      inferred: false,
      inDisease: false,
    });
  });
});

describe('pathwayJson, a Pathway as graph-core serialises it', () => {
  // Java's answer for R-HSA-162582 under /data/pathways/low/entity, 14 Oct 2026.
  const node = {
    dbId: 162582,
    oldStId: 'REACT_111102',
    displayName: 'Signal Transduction',
    stId: 'R-HSA-162582',
    stIdVersion: 'R-HSA-162582.13',
    isInDisease: false,
    isInferred: false,
    maxDepth: 13,
    name: ['Signal Transduction', 'Signaling Pathways'],
    releaseDate: '2011-09-20',
    releaseStatus: 'UPDATED',
    speciesName: 'Homo sapiens',
    hasDiagram: true,
    hasEHLD: true,
    diagramWidth: 631,
    diagramHeight: 589,
    lastUpdatedDate: '2023-06-07',
    schemaClass: 'TopLevelPathway',
  };

  it("writes Java's keys in Java's order, and not the ones it leaves out", () => {
    expect(JSON.stringify(pathwayJson(node))).toBe(
      '{"dbId":162582,"displayName":"Signal Transduction","stId":"R-HSA-162582",' +
        '"stIdVersion":"R-HSA-162582.13","isInDisease":false,"isInferred":false,"maxDepth":13,' +
        '"name":["Signal Transduction","Signaling Pathways"],"releaseDate":"2011-09-20",' +
        '"releaseStatus":"UPDATED","speciesName":"Homo sapiens","hasDiagram":true,"hasEHLD":true,' +
        '"lastUpdatedDate":"2023-06-07","schemaClass":"TopLevelPathway","className":"TopLevelPathway"}'
    );
  });

  it('writes isCanonical where Java declares it, and defaults hasEHLD to false', () => {
    const withoutEhld = { ...node };
    delete withoutEhld.hasEHLD;
    const keys = Object.keys(pathwayJson({ ...withoutEhld, isCanonical: 'true' }));
    expect(keys.slice(keys.indexOf('hasDiagram'), keys.indexOf('hasDiagram') + 4)).toEqual([
      'hasDiagram',
      'hasEHLD',
      'isCanonical',
      'lastUpdatedDate',
    ]);
    expect(pathwayJson(withoutEhld).hasEHLD).toBe(false);
  });

  it('puts a definition after stIdVersion, and a doi after speciesName', () => {
    const keys = Object.keys(pathwayJson({ ...node, definition: 'd', doi: '10.3180/x' }));
    expect(keys.slice(3, 5)).toEqual(['stIdVersion', 'definition']);
    expect(keys.slice(keys.indexOf('speciesName'), keys.indexOf('speciesName') + 2)).toEqual([
      'speciesName',
      'doi',
    ]);
  });
});

describe('speciesFilter, the species parameter as graph-core reads it', () => {
  // SpeciesService.getSpecies: digits are a taxId, then a dbId; anything else
  // a name, matched against Species.name after collapsing runs of '_' and ' '
  // and capitalising the first letter only. Absent or empty: no filter.
  it('filters by nothing when there is no species', () => {
    expect(speciesFilter(undefined)).toEqual({ kind: 'none' });
    expect(speciesFilter('')).toEqual({ kind: 'none' });
  });

  it('reads digits as a taxId first, then a dbId', () => {
    expect(speciesFilter('9606')).toEqual({ kind: 'number', value: '9606' });
  });

  it('reads digits from outside the BMP as a name, as Java does', () => {
    expect(speciesFilter('\u{1D7D2}\u{1D7D6}').kind).toBe('name');
  });

  it('reads anything else as a name, the way Java normalises it', () => {
    expect(speciesFilter('homo_sapiens')).toEqual({ kind: 'name', value: 'Homo sapiens' });
    expect(speciesFilter('HOMO  SAPIENS')).toEqual({ kind: 'name', value: 'Homo sapiens' });
    expect(speciesFilter('mus__musculus')).toEqual({ kind: 'name', value: 'Mus musculus' });
  });
});

describe('referenceEntityJson, a ReferenceEntity as graph-core serialises it', () => {
  // Java's answer for UniProt:P01112 under /participants/R-HSA-5672965/
  // referenceEntities, 14 Oct 2026, keys shortened.
  const labels = ['DatabaseObject', 'ReferenceEntity', 'ReferenceGeneProduct', 'ReferenceSequence'];
  const node = {
    dbId: 62718,
    displayName: 'UniProt:P01112 HRAS',
    stId: 'uniprot:P01112',
    databaseName: 'UniProt',
    identifier: 'P01112',
    name: ['HRAS'],
    otherIdentifier: ['3265'],
    url: 'http://purl.uniprot.org/uniprot/P01112',
    checksum: 'C',
    geneName: ['HRAS', 'HRAS1'],
    isSequenceChanged: false,
    sequenceLength: 189,
    chain: ['chain:1-186'],
    schemaClass: 'ReferenceGeneProduct',
  };

  it("writes Java's keys in Java's order, moleculeType from the class", () => {
    expect(Object.keys(referenceEntityJson(node, labels))).toEqual([
      'dbId',
      'displayName',
      'stId',
      'databaseName',
      'identifier',
      'name',
      'otherIdentifier',
      'url',
      'moleculeType',
      'checksum',
      'geneName',
      'isSequenceChanged',
      'sequenceLength',
      'chain',
      'className',
      'schemaClass',
    ]);
    expect(referenceEntityJson(node, labels).moleculeType).toBe('Protein');
  });

  it('takes the class from the labels, the most specific one, not schemaClass', () => {
    const isoform = [
      'DatabaseObject',
      'ReferenceEntity',
      'ReferenceIsoform',
      'ReferenceGeneProduct',
    ];
    expect(
      referenceEntityJson({ ...node, schemaClass: 'ReferenceIsoform' }, isoform).className
    ).toBe('ReferenceIsoform');
    const dna = ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceDNASequence'];
    const odd = referenceEntityJson({ dbId: 1, schemaClass: '6' }, dna);
    expect([odd.className, odd.moleculeType, odd.schemaClass]).toEqual([
      'ReferenceDNASequence',
      'Entity',
      '6',
    ]);
  });

  it('gives each class the moleculeType its constructor sets, and a group none', () => {
    const type = (leaf) => referenceEntityJson({ dbId: 1 }, ['ReferenceEntity', leaf]).moleculeType;
    expect(type('ReferenceMolecule')).toBe('Chemical');
    expect(type('ReferenceTherapeutic')).toBe('ChemicalDrug');
    expect(type('ReferenceRNASequence')).toBe('Entity');
    expect(type('ReferenceGroup')).toBeUndefined();
  });

  it('leaves out what Java does not write', () => {
    const json = referenceEntityJson({ ...node, trivial: true }, [
      'ReferenceEntity',
      'ReferenceMolecule',
    ]);
    expect('trivial' in json).toBe(false);
  });
});

describe('an answer with no body', () => {
  // Java's controller returns null for an id that is neither a stable id nor a
  // dbId, and Spring sends a 200 with no body and no content type. Reproduced
  // without the database: the id is refused before any query.
  it('is a 200 with nothing in it, and no content type', async () => {
    const response = await fetch(`${base}/ContentService/data/participants/foo/referenceEntities`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-type')).toBeNull();
  });
});

describe('participantJson, graph-core Participant as Java writes it', () => {
  // Java's answer for R-HSA-5672965 under /participants, 14 Oct 2026, one row.
  const row = {
    peDbId: 5672601,
    displayName: 'RAS GEFs [plasma membrane]',
    schemaClass: 'DefinedSet',
    refEntities: [
      {
        icon: 'EntityWithAccessionedSequence',
        displayName: 'UniProt:P29353-2 SHC1',
        url: 'http://purl.uniprot.org/uniprot/P29353-2',
        schemaClass: 'ReferenceIsoform',
        identifier: 'P29353-2',
        stId: 'uniprot:P29353-2',
        dbId: 248232,
      },
    ],
  };

  it("writes Java's keys in Java's order, at both levels", () => {
    expect(JSON.stringify(participantJson(row))).toBe(
      '{"peDbId":5672601,"displayName":"RAS GEFs [plasma membrane]","schemaClass":"DefinedSet",' +
        '"refEntities":[{"dbId":248232,"stId":"uniprot:P29353-2","identifier":"P29353-2",' +
        '"schemaClass":"ReferenceIsoform","displayName":"UniProt:P29353-2 SHC1",' +
        '"icon":"EntityWithAccessionedSequence","url":"http://purl.uniprot.org/uniprot/P29353-2"}]}'
    );
  });

  it('writes a missing reference value as the text "null", as the driver\'s asString does', () => {
    const json = participantJson({ ...row, refEntities: [{ ...row.refEntities[0], url: null }] });
    expect(json.refEntities[0].url).toBe('null');
  });

  it('leaves out a missing participant name or class, as asString(null) does', () => {
    const json = participantJson({ ...row, displayName: null });
    expect('displayName' in json).toBe(false);
  });
});

describe('participantsFrom, the relationships Java follows from the event', () => {
  // Java's two queries differ, and the difference shows: for a Cell, the dbId
  // form reaches its RNA markers and the stable-id form returns [] (checked
  // against Java with R-HSA-9910609 / 9910609, 14 Oct 2026).
  it('follows RNAMarker and proteinMarker for a dbId', () => {
    expect(participantsFrom(true).split('|')).toEqual(
      expect.arrayContaining(['RNAMarker', 'proteinMarker'])
    );
  });

  it('does not for a stable id', () => {
    const relationships = participantsFrom(false).split('|');
    expect(relationships).not.toContain('RNAMarker');
    expect(relationships).not.toContain('proteinMarker');
  });
});

describe('physicalEntityJson, an other form as graph-core serialises it', () => {
  // Java's answers under /entity/{id}/otherForms, 14 Oct 2026.
  const ewas = {
    dbId: 8874327,
    displayName: 'K48polyUb-PTEN [cytosol]',
    stId: 'R-HSA-8874327',
    stIdVersion: 'R-HSA-8874327.2',
    oldStId: 'REACT_1',
    maxDepth: 1,
    name: ['K48polyUb-PTEN'],
    speciesName: 'Homo sapiens',
    endCoordinate: 403,
    referenceType: 'ReferenceGeneProduct',
    startCoordinate: 2,
    isInDisease: false,
    schemaClass: 'EntityWithAccessionedSequence',
  };

  it("writes an EWAS in Java's order, className after the coordinates", () => {
    expect(Object.keys(physicalEntityJson(ewas))).toEqual([
      'dbId',
      'displayName',
      'stId',
      'stIdVersion',
      'maxDepth',
      'name',
      'speciesName',
      'endCoordinate',
      'referenceType',
      'startCoordinate',
      'className',
      'inDisease',
      'schemaClass',
    ]);
  });

  it('names an EWAS by its reference type, as getClassName does', () => {
    const name = (referenceType) => physicalEntityJson({ ...ewas, referenceType }).className;
    expect(name('ReferenceGeneProduct')).toBe('Protein');
    expect(name('ReferenceDNASequence')).toBe('DNA Sequence');
    expect(name('ReferenceRNASequence')).toBe('RNA Sequence');
    expect(name('ReferenceIsoform')).toBe('Genes and Transcripts');
    expect(physicalEntityJson({ ...ewas, referenceType: null }).className).toBe(
      'Genes and Transcripts'
    );
  });

  it('puts definition after stIdVersion and systematicName after speciesName', () => {
    const keys = Object.keys(physicalEntityJson({ ...ewas, definition: 'd', systematicName: 's' }));
    expect(keys.slice(3, 5)).toEqual(['stIdVersion', 'definition']);
    expect(keys[keys.indexOf('speciesName') + 1]).toBe('systematicName');
  });

  // Java's answers under /complex/{id}/subunits, 17 Oct 2026: the keys after
  // name, by class.
  it.each([
    [
      'Complex',
      { speciesName: 'H', isChimeric: false, stoichiometryKnown: true },
      'Complex',
      'last',
    ],
    ['Complex', { speciesName: 'H', systematicName: 's', isChimeric: true }, 'Complex', 'last'],
    ['DefinedSet', { speciesName: 'H', systematicName: 's' }, 'Set', 'before'],
    ['CandidateSet', { speciesName: 'H', isOrdered: true }, 'Set', 'before'],
    ['OpenSet', { speciesName: 'H' }, 'Set', 'before'],
    ['GenomeEncodedEntity', { speciesName: 'H' }, 'Genes and Transcripts', 'before'],
    ['Polymer', { speciesName: 'H', maxUnitCount: 2, minUnitCount: 1 }, 'Polymer', 'last'],
    ['OtherEntity', { definition: 'd' }, 'OtherEntity', 'last'],
    ['ProteinDrug', {}, 'ProteinDrug', 'last'],
    ['Cell', { speciesName: 'H' }, 'Cell', 'last'],
  ])('writes a %s as Java does', (schemaClass, own, className, where) => {
    const json = physicalEntityJson({
      dbId: 1,
      name: ['n'],
      ...own,
      isInDisease: false,
      schemaClass,
    });
    const ownKeys = Object.keys(own).filter((key) => key !== 'definition');
    const end =
      where === 'last'
        ? ['inDisease', 'schemaClass', 'className']
        : ['className', 'inDisease', 'schemaClass'];
    expect(Object.keys(json)).toEqual([
      'dbId',
      ...('definition' in own ? ['definition'] : []),
      'name',
      ...ownKeys,
      ...end,
    ]);
    expect(json.className).toBe(className);
  });

  it('calls a simple entity a Chemical Compound', () => {
    const se = {
      dbId: 1,
      schemaClass: 'SimpleEntity',
      referenceType: 'ReferenceMolecule',
      isInDisease: false,
    };
    expect(Object.keys(physicalEntityJson(se))).toEqual([
      'dbId',
      'referenceType',
      'className',
      'inDisease',
      'schemaClass',
    ]);
    expect(physicalEntityJson(se).className).toBe('Chemical Compound');
  });

  it('writes a drug with its class name last, after schemaClass', () => {
    const drug = { dbId: 2, name: ['x'], isInDisease: false, schemaClass: 'ChemicalDrug' };
    expect(JSON.stringify(physicalEntityJson(drug))).toBe(
      '{"dbId":2,"name":["x"],"inDisease":false,"schemaClass":"ChemicalDrug","className":"ChemicalDrug"}'
    );
  });

  it('never writes oldStId, which DatabaseObject ignores', () => {
    expect('oldStId' in physicalEntityJson(ewas)).toBe(false);
  });
});

/** A graph-core HierarchyTreeItem row: [stId, displayName, hasDiagram, speciesName, schemaClass, labels, order]. */
const item = (
  stId,
  schemaClass = 'Pathway',
  { diagram = false, order = 0, species = 'Homo sapiens' } = {}
) => [stId, `${stId} name`, diagram, species, schemaClass, ['DatabaseObject'], order];

describe("PathwayBrowserNode children, graph-core's TreeSet", () => {
  const node = (name, { species = 'Homo sapiens', order } = {}) =>
    Object.assign(new PathwayBrowserNode(), { stId: name, name, species, order });

  it('orders by species, then order, then name by UTF-16 unit, as compareTo does', () => {
    const parent = new PathwayBrowserNode();
    for (const child of [
      node('b'),
      node('a', { order: 1 }),
      node('c'),
      node('a', { species: 'Mus musculus' }),
      node('B'),
    ]) {
      parent.addChild(child);
    }
    expect(parent.children.map((c) => `${c.species}/${c.order ?? 0}/${c.name}`)).toEqual([
      'Homo sapiens/0/B',
      'Homo sapiens/0/b',
      'Homo sapiens/0/c',
      'Homo sapiens/1/a',
      'Mus musculus/0/a',
    ]);
  });

  it('keeps the first of two nodes that compare equal, as a TreeSet does', () => {
    const parent = new PathwayBrowserNode();
    const first = node('same');
    parent.addChild(first);
    parent.addChild(node('same'));
    expect(parent.children).toEqual([first]);
    expect(parent.children[0]).toBe(first);
  });

  it('sorts a node with no species before one with a species', () => {
    const parent = new PathwayBrowserNode();
    parent.addChild(node('z'));
    parent.addChild(node('y', { species: null }));
    expect(parent.children.map((c) => c.name)).toEqual(['y', 'z']);
  });
});

describe('parseHierarchy, graph-core HierarchyRepository.parseRaw', () => {
  const root = item('R-HSA-1', 'EntityWithAccessionedSequence');
  root[5] = ['DatabaseObject', 'PhysicalEntity'];

  it('extends the previous path by its last step, and restarts from the root otherwise', () => {
    const tree = parseHierarchy(
      root,
      [
        [item('A')],
        [item('A'), item('B')],
        [item('A'), item('B'), item('C')],
        [item('D')],
        [item('D'), item('B')],
      ],
      true
    );
    expect(tree.children.map((c) => c.stId)).toEqual(['A', 'D']);
    const [a, d] = tree.children;
    // One node per stId: B is shared, reached from A and from D.
    expect(a.children[0]).toBe(d.children[0]);
    expect(a.children[0].children.map((c) => c.stId)).toEqual(['C']);
    expect(a.children[0].parent.map((p) => p.stId)).toEqual(['A', 'D']);
  });

  it('keeps the quirk: a longer path is attached to the previous node, whatever it starts with', () => {
    // Java only compares lengths, so a two-step path after a one-step one hangs
    // its last node off the previous path's end.
    const tree = parseHierarchy(root, [[item('A')], [item('C'), item('E')]], true);
    expect(tree.children.map((c) => c.stId)).toEqual(['A']);
    expect(tree.children[0].children.map((c) => c.stId)).toEqual(['E']);
  });

  it('skips what the browser cannot show, unless asked not to', () => {
    const paths = [
      [item('X', 'Reaction')],
      [item('X', 'Reaction'), item(null, 'CatalystActivity')],
      [item('X', 'Reaction'), item(null, 'CatalystActivity'), item('Y')],
    ];
    const omitted = parseHierarchy(root, paths, true);
    expect(omitted.children[0].children.map((c) => c.stId)).toEqual(['Y']);
    const kept = parseHierarchy(root, paths, false);
    expect(kept.children[0].children.map((c) => c.type)).toEqual(['CatalystActivity']);
  });

  it('gives the root a species only for an event or entity, and a diagram flag only for a pathway', () => {
    expect(parseHierarchy(root, [], true)).toMatchObject({ species: 'Homo sapiens' });
    expect(parseHierarchy(root, [], true).diagram).toBeUndefined();
    const other = item('R-HSA-2', 'ReferenceGeneProduct');
    expect(parseHierarchy(other, [], true).species).toBeUndefined();
    const pathway = item('R-HSA-3', 'TopLevelPathway', { diagram: true });
    pathway[5] = ['DatabaseObject', 'Event', 'Pathway', 'TopLevelPathway'];
    expect(parseHierarchy(pathway, [], true)).toMatchObject({
      diagram: true,
      species: 'Homo sapiens',
    });
  });

  it('reads a missing order and diagram as Java does: 0 and false', () => {
    const tree = parseHierarchy(
      root,
      [[['A', 'A', null, 'Homo sapiens', 'Pathway', [], null]]],
      true
    );
    expect(tree.children[0]).toMatchObject({ order: 0, diagram: false });
  });
});

describe('locationsInPathwayBrowser, PathwayBrowserLocationsUtils', () => {
  const entity = () => {
    const root = item('E', 'EntityWithAccessionedSequence');
    root[5] = ['DatabaseObject', 'PhysicalEntity'];
    return root;
  };

  it('turns the reverse graph into trees from each top-level pathway, with browser urls', () => {
    const rx = item('Rx', 'Reaction');
    const p1 = item('P1', 'Pathway', { diagram: true });
    const t = item('T', 'TopLevelPathway', { diagram: true });
    const trees = locationsInPathwayBrowser(
      parseHierarchy(entity(), [[rx], [rx, p1], [rx, p1, t]], true)
    );
    expect(JSON.stringify(trees.map(pathwayBrowserJson))).toBe(
      JSON.stringify([
        {
          stId: 'T',
          name: 'T name',
          species: 'Homo sapiens',
          url: '/PathwayBrowser/#/T',
          type: 'TopLevelPathway',
          children: [
            {
              stId: 'P1',
              name: 'P1 name',
              species: 'Homo sapiens',
              url: '/PathwayBrowser/#/P1',
              type: 'Pathway',
              children: [
                {
                  stId: 'Rx',
                  name: 'Rx name',
                  species: 'Homo sapiens',
                  url: '/PathwayBrowser/#/P1&amp;SEL=Rx&amp;PATH=T',
                  type: 'Reaction',
                  children: [
                    {
                      stId: 'E',
                      name: 'E name',
                      species: 'Homo sapiens',
                      url: '/PathwayBrowser/#/P1&amp;SEL=E&amp;PATH=T',
                      type: 'EntityWithAccessionedSequence',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ])
    );
  });

  it('gives a pathway in two places its own address, and the entity the last diagram', () => {
    const p = item('P', 'Pathway');
    const t1 = item('T1', 'TopLevelPathway', { diagram: true });
    const t2 = item('T2', 'TopLevelPathway', { diagram: true });
    const trees = locationsInPathwayBrowser(
      parseHierarchy(entity(), [[p], [p, t1], [p, t2]], true)
    );
    expect(trees.map((t) => t.stId)).toEqual(['T1', 'T2']);
    expect(trees[0].children[0].url).toBe('/PathwayBrowser/#/P');
    expect(trees[0].children[0].children[0].url).toBe('/PathwayBrowser/#/T1&amp;SEL=E');
    expect(trees[1].children[0].children[0].url).toBe('/PathwayBrowser/#/T2&amp;SEL=E');
  });

  it('drops branches that end anywhere but a top-level pathway', () => {
    const trees = locationsInPathwayBrowser(
      parseHierarchy(entity(), [[item('C', 'Complex')], [item('P', 'Pathway')]], true)
    );
    expect(trees).toEqual([]);
  });

  it('answers a top-level pathway with itself', () => {
    const t = item('T', 'TopLevelPathway', { diagram: true });
    t[5] = ['DatabaseObject', 'Event', 'Pathway', 'TopLevelPathway'];
    expect(locationsInPathwayBrowser(parseHierarchy(t, [], true)).map(pathwayBrowserJson)).toEqual([
      {
        stId: 'T',
        name: 'T name',
        species: 'Homo sapiens',
        url: '/PathwayBrowser/#/T',
        type: 'TopLevelPathway',
      },
    ]);
  });
});

describe('pathwayBrowserJson, PathwayBrowserNode as Jackson writes it', () => {
  it("writes Java's keys in field order, leaving out what is empty", () => {
    const node = Object.assign(new PathwayBrowserNode(), {
      type: 'Pathway',
      diagram: false,
      stId: 'R-HSA-1',
      name: 'x',
      order: 3,
      unique: true,
    });
    expect(JSON.stringify(pathwayBrowserJson(node))).toBe(
      '{"stId":"R-HSA-1","name":"x","type":"Pathway","diagram":false}'
    );
  });
});

describe('springBoolean, a Boolean request parameter as Spring converts it', () => {
  it('is absent for no value or an empty one', () => {
    expect(springBoolean([])).toEqual({ value: undefined });
    expect(springBoolean([''])).toEqual({ value: undefined });
    expect(springBoolean(['  '])).toEqual({ value: undefined });
  });

  it('accepts true/on/yes/1 and false/off/no/0, any case, trimmed', () => {
    for (const raw of ['true', 'TRUE', 'on', 'Yes', '1', ' true ']) {
      expect(springBoolean([raw])).toEqual({ value: true });
    }
    for (const raw of ['false', 'OFF', 'no', '0']) {
      expect(springBoolean([raw])).toEqual({ value: false });
    }
  });

  it('takes the first of several values', () => {
    expect(springBoolean(['false', 'true'])).toEqual({ value: false });
  });

  it("refuses anything else with Spring's message, the value as sent", () => {
    expect(springBoolean([' foo '])).toEqual({
      error:
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; " +
        'nested exception is java.lang.IllegalArgumentException: Invalid boolean value [ foo ]',
    });
    expect(springBoolean(['\u2028']).error).toMatch(/\[\u2028\]$/);
  });
});

describe('/detail/{id}/locationsInPWB without a database', () => {
  const path = '/ContentService/data/detail/{id}/locationsInPWB';

  it('is served, on the path Java uses', () => {
    expect(endpoints.map((e) => e.path)).toContain(path);
  });

  it("refuses an unreadable boolean with Java's 400, before reading the id", async () => {
    const response = await fetch(
      `${base}/ContentService/data/detail/foo/locationsInPWB?directParticipants=true&omitNonDisplayableItems=bar`
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    const body = await response.json();
    expect(body).toMatchObject({ code: 400, reason: 'BAD_REQUEST', targets: null });
    expect(body.messages).toEqual([
      "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; " +
        'nested exception is java.lang.IllegalArgumentException: Invalid boolean value [bar]',
    ]);
    // Java's url leaves the query out.
    expect(body.url).toMatch(/\/ContentService\/data\/detail\/foo\/locationsInPWB$/);
  });

  it("answers a dbId past a long's range with Java's 500, as Long.parseLong fails", async () => {
    const response = await fetch(
      `${base}/ContentService/data/detail/99999999999999999999.2/locationsInPWB`
    );
    expect(response.status).toBe(500);
    expect((await response.json()).messages).toEqual(['For input string: "99999999999999999999"']);
  });

  it("answers an id that is neither a stable id nor a dbId with Java's 404", async () => {
    const response = await fetch(`${base}/ContentService/data/detail/foo/locationsInPWB`);
    expect(response.status).toBe(404);
    expect((await response.json()).messages).toEqual(['Reverse sub graph found for id: foo']);
  });
});

describe("locationsQuery, graph-core's locations queries", () => {
  // The paths' order is the answer's, so the match and the expansion must be
  // Java's text exactly (HierarchyRepository, the deployed graph-core jar).
  const all =
    'regulatedBy|regulator|physicalEntity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|activeUnit|catalystActivity|repeatedUnit|hasMember|hasCandidate|hasComponent|input|output|hasEvent|proteinMarker|RNAMarker';
  const direct =
    'regulatedBy|regulator|physicalEntity|catalystActivity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|input|output|hasEvent';
  const cases = [
    [false, false, `MATCH (n:DatabaseObject{stId:$stId}) OPTIONAL MATCH path=(n)<-[:${all}*]-() `],
    [true, false, `MATCH (n:DatabaseObject{dbId:$dbId}) OPTIONAL MATCH path=(n)<-[:${all}*]-() `],
    [
      false,
      true,
      `MATCH (n:DatabaseObject{stId:$stId}) OPTIONAL MATCH path=(n)<-[:${direct}*]-() `,
    ],
    [true, true, `MATCH (n:DatabaseObject{dbId:$dbId}) OPTIONAL MATCH path=(n)<-[:${direct}*]-() `],
  ];
  for (const [byDbId, directParticipants, java] of cases) {
    it(`matches and expands as Java does (dbId ${byDbId}, direct ${directParticipants})`, () => {
      expect(locationsQuery(byDbId, directParticipants).startsWith(java)).toBe(true);
    });
  }
});

describe('servletParameter, a query parameter as Tomcat reads it', () => {
  // Each case measured against Java's /detail/{id}/locationsInPWB, 14 Oct 2026.
  it('drops a pair whose name or value has a malformed escape, keeping the rest', () => {
    expect(servletParameter('directParticipants=%zz', 'directParticipants')).toEqual([]);
    expect(servletParameter('directParticipants=%', 'directParticipants')).toEqual([]);
    expect(servletParameter('directParticipants=%2', 'directParticipants')).toEqual([]);
    expect(servletParameter('directParticipants=true%zz', 'directParticipants')).toEqual([]);
    expect(servletParameter('direct%zzParticipants=true', 'directParticipants')).toEqual([]);
    expect(
      servletParameter('directParticipants=%zz&directParticipants=true', 'directParticipants')
    ).toEqual(['true']);
    expect(servletParameter('%zz=1&directParticipants=true', 'directParticipants')).toEqual([
      'true',
    ]);
  });

  it('decodes names and values as UTF-8, + as a space, a bad sequence as U+FFFD', () => {
    expect(servletParameter('direct%50articipants=tr%75e', 'directParticipants')).toEqual(['true']);
    expect(servletParameter('directParticipants=+on+', 'directParticipants')).toEqual([' on ']);
    expect(servletParameter('directParticipants=%2Btrue', 'directParticipants')).toEqual(['+true']);
    expect(servletParameter('directParticipants=%C3%A9', 'directParticipants')).toEqual(['\u00e9']);
    expect(servletParameter('directParticipants=%FF', 'directParticipants')).toEqual(['\ufffd']);
    expect(servletParameter('directParticipants=%e2%80', 'directParticipants')).toEqual(['\ufffd']);
    // Java's decoder, not the WHATWG one, where they part: an encoded surrogate
    // (ED A0..BF, then a continuation if present) is one U+FFFD, not one per byte.
    const decoded = (escapes) => servletParameter(`d=${escapes}`, 'd')[0];
    expect(decoded('%ED%A0%80')).toBe('\ufffd');
    expect(decoded('%ED%BF%BF')).toBe('\ufffd');
    expect(decoded('%ED%A0')).toBe('\ufffd');
    expect(decoded('%ED%A0%41')).toBe('\ufffdA');
    expect(decoded('%ED%A0%80%ED%B0%80')).toBe('\ufffd\ufffd');
    expect(decoded('%ED%9F%BF')).toBe('\ud7ff');
    // and where they agree: one per byte of an overlong or out-of-range form.
    expect(decoded('%E0%80%80')).toBe('\ufffd\ufffd\ufffd');
    expect(decoded('%F8%88%80%80%80')).toBe('\ufffd'.repeat(5));
    expect(decoded('%E2%80%41')).toBe('\ufffdA');
    // A byte order mark is a character like any other to Java's decoder.
    expect(servletParameter('directParticipants=%EF%BB%BFtrue', 'directParticipants')).toEqual([
      '\ufefftrue',
    ]);
  });

  it('reads a name without = as an empty value, and splits only at the first =', () => {
    expect(servletParameter('directParticipants', 'directParticipants')).toEqual(['']);
    expect(servletParameter('directParticipants=a=b', 'directParticipants')).toEqual(['a=b']);
    expect(servletParameter('&&=true&directParticipants=true;x', 'directParticipants')).toEqual([
      'true;x',
    ]);
  });
});

describe("springBoolean's second try, Spring's CustomBooleanEditor", () => {
  // StringToBooleanConverter lower-cases and fails on the long s; the
  // editor Spring falls back to compares with equalsIgnoreCase, for which
  // ſ is s. Java bound /search/facet_query's "Force filters=yeſ" as true
  // (16 Oct 2026). The editor reads every value joined by ','.
  it('matches the words as String.equalsIgnoreCase does', () => {
    expect(springBoolean(['yeſ'])).toEqual({ value: true });
    expect(springBoolean([' falſe '])).toEqual({ value: false });
    expect(springPrimitiveBoolean(['yeſ'], false)).toEqual({ value: true });
  });
  it('reads several values joined, so a second value makes it fail', () => {
    expect(springBoolean(['yeſ', 'true']).error).toMatch(/Invalid boolean value \[yeſ,true\]/);
  });
});

describe('springBoolean with several values', () => {
  const several = (values) =>
    "Failed to convert value of type 'java.lang.String[]' to required type 'java.lang.Boolean'; " +
    `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${values}]`;

  it('is decided by the first value', () => {
    expect(springBoolean(['true', 'foo'])).toEqual({ value: true });
    expect(springBoolean(['false', 'foo'])).toEqual({ value: false });
    expect(springBoolean(['', 'true'])).toEqual({ value: undefined });
    expect(springBoolean([' ', 'true'])).toEqual({ value: undefined });
  });

  it('names the array type and every value, joined and untrimmed, when the first is refused', () => {
    expect(springBoolean(['foo', 'true'])).toEqual({ error: several('foo,true') });
    expect(springBoolean(['foo', ''])).toEqual({ error: several('foo,') });
    expect(springBoolean([' foo ', 'x'])).toEqual({ error: several(' foo ,x') });
    expect(springBoolean(['foo', 'bar', 'baz'])).toEqual({ error: several('foo,bar,baz') });
  });
});

describe('locationsInPWB reads its query as the servlet does', () => {
  it('ignores a parameter it cannot decode rather than refusing it', async () => {
    // No database: an unreadable id answers before any query, so a 404 here
    // means the malformed pair was dropped, and a 400 that it was not.
    for (const query of [
      'directParticipants=%zz',
      'directParticipants=%',
      'directParticipants=true&omitNonDisplayableItems=%zz',
    ]) {
      const response = await fetch(
        `${base}/ContentService/data/detail/foo/locationsInPWB?${query}`
      );
      expect(response.status, query).toBe(404);
    }
  });

  it('reads everything after the first ?, a second ? included', async () => {
    const response = await fetch(
      `${base}/ContentService/data/detail/foo/locationsInPWB?x=1?&directParticipants=bad`
    );
    expect(response.status).toBe(400);
  });
});

describe('springInteger, an Integer request parameter as Spring converts it', () => {
  // Every case measured against Java's /data/schema/Pathway/min, 14 Oct 2026.
  const refused = (type, message) =>
    `Failed to convert value of type '${type}' to required type 'java.lang.Integer'; ` +
    `nested exception is java.lang.NumberFormatException: ${message}`;
  const one = (message) => ({ error: refused('java.lang.String', message) });
  const several = (message) => ({ error: refused('java.lang.String[]', message) });

  it('names a missing parameter, and one that is present but empty', () => {
    expect(springInteger([], 'page')).toEqual({
      error: "Required request parameter 'page' for method parameter type Integer is not present",
    });
    for (const blank of ['', ' ', '\t', '\u3000']) {
      expect(springInteger([blank], 'offset')).toEqual({
        error:
          "Required request parameter 'offset' for method parameter type Integer is present but converted to null",
      });
    }
  });

  it('reads what NumberUtils.parseNumber reads: signs, hex, any whitespace removed, any digits', () => {
    const cases = [
      ['1', 1],
      ['+1', 1],
      ['01', 1],
      ['0x1', 1],
      ['#1', 1],
      ['-0x1', -1],
      ['0X1F', 31],
      ['1 0', 10],
      ['\t1', 1],
      ['\u20031', 1],
      ['\u30001', 1],
      ['\u0661', 1],
      ['\uff11', 1],
      ['0x\uff21', 10],
      ['0x7FFFFFFF', 2147483647],
      ['-2147483648', -2147483648],
      ['-0x80000000', -2147483648],
    ];
    for (const [raw, value] of cases) expect(springInteger([raw], 'page'), raw).toEqual({ value });
  });

  it("refuses the rest with the NumberFormatException Java's parser throws", () => {
    expect(springInteger(['x'], 'page')).toEqual(one('For input string: "x"'));
    expect(springInteger(['2147483648'], 'page')).toEqual(one('For input string: "2147483648"'));
    expect(springInteger(['99999999999999999999'], 'page')).toEqual(
      one('For input string: "99999999999999999999"')
    );
    expect(springInteger(['1.0'], 'page')).toEqual(one('For input string: "1.0"'));
    expect(springInteger(['1e2'], 'page')).toEqual(one('For input string: "1e2"'));
    expect(springInteger(['1,2'], 'page')).toEqual(one('For input string: "1,2"'));
    expect(springInteger(['-'], 'page')).toEqual(one('For input string: "-"'));
    expect(springInteger(['+0x1'], 'page')).toEqual(one('For input string: "+0x1"'));
    // A no-break space is not whitespace to Java, so it is kept and refused.
    expect(springInteger(['\u00a01'], 'page')).toEqual(one('For input string: "\u00a01"'));
    expect(springInteger(['\u00a0'], 'page')).toEqual(one('For input string: "\u00a0"'));
    expect(springInteger(['\u0001'], 'page')).toEqual(one('For input string: "\u0001"'));
    // Integer.decode's own messages.
    expect(springInteger(['0x'], 'page')).toEqual(one('For input string: ""'));
    expect(springInteger(['#'], 'page')).toEqual(one('For input string: ""'));
    expect(springInteger(['0x80000000'], 'page')).toEqual(one('For input string: "80000000"'));
    expect(springInteger(['-0xZZ'], 'page')).toEqual(one('For input string: "-ZZ"'));
    expect(springInteger(['0x-1'], 'page')).toEqual(one('Sign character in wrong position'));
  });

  it('reads the first of several values, and names them all, joined, when it cannot', () => {
    expect(springInteger(['1', 'x'], 'page')).toEqual({ value: 1 });
    expect(springInteger(['1', '2'], 'page')).toEqual({ value: 1 });
    expect(springInteger(['', '1'], 'page')).toEqual({
      error:
        "Required request parameter 'page' for method parameter type Integer is present but converted to null",
    });
    expect(springInteger(['x', '1'], 'page')).toEqual(several('For input string: "x,1"'));
    // The whitespace-only first value fails the converter, and the joined
    // retry then loses its whitespace as every parse does.
    expect(springInteger([' ', '1'], 'page')).toEqual(several('For input string: ",1"'));
  });
});

describe('schemaWindow, the SKIP and LIMIT of /schema/{className}/min', () => {
  it('pages as graph-core does: skip (page - 1) * offset, at most 20000 rows', () => {
    expect(schemaWindow(1, 3)).toEqual({ skip: 0, limit: 3 });
    expect(schemaWindow(3, 25)).toEqual({ skip: 50, limit: 25 });
    expect(schemaWindow(2, 25000)).toEqual({ skip: 20000, limit: 20000 });
    expect(schemaWindow(1, 2147483647)).toEqual({ skip: 0, limit: 20000 });
  });

  it('passes negative values on for Neo4j to refuse, as Java does', () => {
    expect(schemaWindow(0, 5)).toEqual({ skip: -5, limit: 5 });
    expect(schemaWindow(1, -1)).toEqual({ skip: 0, limit: -1 });
  });

  it("overflows as Java's int arithmetic does", () => {
    expect(schemaWindow(-2147483648, 1)).toEqual({ skip: 2147483647, limit: 1 });
    expect(schemaWindow(1073741825, 2)).toEqual({ skip: -2147483648, limit: 2 });
  });
});

describe("schema queries, graph-core SchemaRepository's text", () => {
  // The row order of a page is the plan's, so the text is Java's exactly.
  const ret =
    'RETURN DISTINCT(n.dbId) as dbId, n.stId as stId, n.displayName as displayName, labels(n) as labels ' +
    'ORDER BY n.displayName SKIP $skip LIMIT $limit';
  it('pages a class, with or without a species', () => {
    expect(schemaMinQuery('Pathway')).toBe(`MATCH (n:Pathway) ${ret}`);
    expect(schemaMinQuery('Pathway', 'taxId')).toBe(
      `MATCH (s:Species{taxId:$taxId})<-[:species]-(n:Pathway) ${ret}`
    );
    expect(schemaMinQuery('Pathway', 'speciesName')).toBe(
      `MATCH (s:Species{displayName:$speciesName})<-[:species]-(n:Pathway) ${ret}`
    );
  });

  it('counts a class, with or without a species', () => {
    expect(schemaCountQuery('Pathway')).toBe('MATCH (n:`Pathway`) RETURN count(n) AS n');
    expect(schemaCountQuery('Pathway', 'taxId')).toBe(
      'MATCH (s:Species{taxId:$taxId})<-[:species]-(n:Pathway) RETURN COUNT(n) AS n'
    );
    expect(schemaCountQuery('Pathway', 'speciesName')).toBe(
      'MATCH (s:Species{displayName:$speciesName})<-[:species]-(n:Pathway) RETURN COUNT(n) AS n'
    );
  });
});

describe('simpleObjectJson, SimpleDatabaseObject as Java writes it', () => {
  it('writes dbId, stId, displayName and the class the labels name, in that order', () => {
    const row = {
      labels: ['DatabaseObject', 'Event', 'Pathway', 'Trackable', 'Deletable'],
      displayName: 'Apoptosis',
      stId: 'R-HSA-109581',
      dbId: 109581,
    };
    expect(JSON.stringify(simpleObjectJson(row))).toBe(
      '{"dbId":109581,"stId":"R-HSA-109581","displayName":"Apoptosis","schemaClass":"Pathway"}'
    );
  });

  it('leaves out a missing or empty stId, and writes a missing name as asString does', () => {
    expect(
      JSON.stringify(
        simpleObjectJson({
          dbId: 1,
          stId: null,
          displayName: null,
          labels: ['DatabaseObject', 'Summation'],
        })
      )
    ).toBe('{"dbId":1,"displayName":"null","schemaClass":"Summation"}');
    expect(
      JSON.stringify(
        simpleObjectJson({ dbId: 1, stId: '', displayName: '', labels: ['DatabaseObject'] })
      )
    ).toBe('{"dbId":1,"schemaClass":"DatabaseObject"}');
  });
});

describe('javaJson, JSON as Jackson writes it', () => {
  it('escapes control characters with upper-case hex, and the usual ones short', () => {
    expect(javaJson('\u0001\n\t\u001f\u000b\b\f\r')).toBe('"\\u0001\\n\\t\\u001F\\u000B\\b\\f\\r"');
  });

  it('leaves DEL, the line separators and / as they are, and escapes " and \\', () => {
    expect(javaJson('\u007f\u2028/"\\<')).toBe('"\u007f\u2028/\\"\\\\<"');
  });

  it('does not mistake an escaped backslash for an escape', () => {
    expect(javaJson('\\u001f')).toBe('"\\\\u001f"');
    expect(javaJson('\\\u001f')).toBe('"\\\\\\u001F"');
  });
});

describe('neo4jFailureMessage, a Neo4j client error as Spring reports it', () => {
  it("is Neo4j's message, its code, and the driver's exception", () => {
    const message =
      "SKIP: Invalid input. '-1' is not a valid value. Must be a non-negative integer.";
    expect(neo4jFailureMessage({ code: 'Neo.ClientError.Statement.ArgumentError', message })).toBe(
      `${message}; Error code 'Neo.ClientError.Statement.ArgumentError'; ` +
        `nested exception is org.neo4j.driver.exceptions.ClientException: ${message}`
    );
  });

  it("is nothing for an error that is not an argument error, which is not Java's to mirror", () => {
    expect(neo4jFailureMessage(new Error('connection refused'))).toBeUndefined();
  });
});

describe('/schema/{className}/count and /min without a database', () => {
  const at = (path) => `${base}/ContentService/data/schema/${path}`;
  const text = async (path) => {
    const response = await fetch(at(path));
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      body: await response.text(),
    };
  };
  const envelope = (code, reason, path, message) =>
    JSON.stringify({
      code,
      reason,
      url: `${base}/ContentService/data/schema/${path}`,
      messages: [message],
      targets: null,
    });

  it('serves both, on the paths Java uses', () => {
    const paths = endpoints.map((e) => e.path);
    expect(paths).toContain('/ContentService/data/schema/{id}/count');
    expect(paths).toContain('/ContentService/data/schema/{id}/min');
  });

  it('answers a class Java does not have with its 500, case and all', async () => {
    for (const [path, url] of [
      ['Foo/count', 'Foo/count'],
      ['pathway/count', 'pathway/count'],
      ['Pathway%3Bx/count', 'Pathway%3Bx/count'],
      ['Foo/min?page=1&offset=1&species=9606', 'Foo/min'],
    ]) {
      const answer = await text(path);
      expect(answer.status, path).toBe(500);
      expect(answer.type, path).toMatch(/^application\/json/);
      expect(answer.body, path).toBe(
        envelope(500, 'INTERNAL_SERVER_ERROR', url, 'Specified class was not found')
      );
    }
  });

  it('refuses a species for a class without one, before asking the graph', async () => {
    let answer = await text('Person/count?species=9606');
    expect(answer.status).toBe(404);
    expect(answer.body).toBe(
      envelope(404, 'NOT_FOUND', 'Person/count', 'No entries have been found for species: 9606')
    );
    answer = await text('CandidateSet$AjcClosure5/count?species=9606&species=x');
    expect(answer.body).toBe(
      envelope(
        404,
        'NOT_FOUND',
        'CandidateSet$AjcClosure5/count',
        'No entries have been found for species: 9606,x'
      )
    );
    answer = await text('Person/min?page=1&offset=1&species=');
    expect(answer.status).toBe(404);
    expect(answer.body).toBe(
      envelope(404, 'NOT_FOUND', 'Person/min', 'No entries found for class: Person')
    );
  });

  it('writes the species as Jackson would, control characters included', async () => {
    const answer = await text('Person/count?species=%1F%0B');
    expect(answer.body).toContain('"No entries have been found for species: \\u001F\\u000B"');
  });

  it('reads page and offset before the class, as Spring binds them first', async () => {
    let answer = await text('Foo/min');
    expect(answer.status).toBe(400);
    expect(answer.body).toBe(
      envelope(
        400,
        'BAD_REQUEST',
        'Foo/min',
        "Required request parameter 'page' for method parameter type Integer is not present"
      )
    );
    answer = await text('Foo/min?page=1&offset=%zz');
    expect(JSON.parse(answer.body).messages).toEqual([
      "Required request parameter 'offset' for method parameter type Integer is not present",
    ]);
    answer = await text('Foo/min?page=x&page=1&offset=1');
    expect(JSON.parse(answer.body).messages).toEqual([
      "Failed to convert value of type 'java.lang.String[]' to required type 'java.lang.Integer'; " +
        'nested exception is java.lang.NumberFormatException: For input string: "x,1"',
    ]);
  });
});

describe('error bodies, written as Jackson writes them', () => {
  // Java (Jackson) writes a control character without a short escape as
  // `\u001F`; JSON.stringify writes `\u001f`. Measured against Java on
  // 14 Oct 2026: /data/query/R-HSA-%1F%0B/stId, /data/pathways/top/%1F%0B and
  // /data/event/R-HSA-%1F/ancestors all answer `\u001F\u000B` in the message.
  const request = {
    originalUrl: '/ContentService/data/x/%1F%0B?y=1',
    protocol: 'http',
    get: () => 'h',
  };

  // And, like every Java error url, without the query: request.getRequestURL.
  // Measured: /data/pathways/low/entity/foo?species=9606 and
  // /data/pathways/top/99999999?x=1 both name the path alone.
  it('upper-cases the escapes in a 404 from notFound, and leaves the query out', () => {
    const answer = notFound(request, 'Id: R-HSA-\u001f\u000b has not been found in the System');
    expect(answer.status).toBe(404);
    expect(answer.body).toBe(
      '{"code":404,"reason":"NOT_FOUND","url":"http://h/ContentService/data/x/%1F%0B",' +
        '"messages":["Id: R-HSA-\\u001F\\u000B has not been found in the System"],"targets":null}'
    );
  });

  it('upper-cases the escapes in any status from javaError', () => {
    const answer = javaError(request, 400, 'BAD_REQUEST', 'x\u001a\u000e\u000f');
    expect(answer.body).toBe(
      '{"code":400,"reason":"BAD_REQUEST","url":"http://h/ContentService/data/x/%1F%0B",' +
        '"messages":["x\\u001A\\u000E\\u000F"],"targets":null}'
    );
  });

  it('reaches the wire that way, as Java answers a bad Boolean', async () => {
    const response = await fetch(
      `${base}/ContentService/data/detail/foo/locationsInPWB?directParticipants=x%1F%0B`
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.text()).toContain('Invalid boolean value [x\\u001F\\u000B]"]');
  });
});

describe('/schema/{className}/attributes and /referrals without a database', () => {
  const at = (path) => `${base}/ContentService/data/schema/${path}`;
  const text = async (path) => {
    const response = await fetch(at(path));
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      body: await response.text(),
    };
  };
  const sha = (body) => createHash('sha256').update(body).digest('hex');
  const classNotFound = (path) =>
    JSON.stringify({
      code: 500,
      reason: 'INTERNAL_SERVER_ERROR',
      url: `${base}/ContentService/data/schema/${path}`,
      messages: ['Specified class was not found'],
      targets: null,
    });

  it('serves the three, on the paths Java uses', () => {
    const paths = endpoints.map((e) => e.path);
    expect(paths).toContain('/ContentService/data/schema/model');
    expect(paths).toContain('/ContentService/data/schema/{id}/attributes');
    expect(paths).toContain('/ContentService/data/schema/{id}/referrals');
  });

  // Java's own bytes, by sha256, taken from :8080 on 14 Oct 2026 -- not from
  // the snapshot, so these check the snapshot and the way node composes it.
  it("answers Java's bytes for a class", async () => {
    for (const [path, digest, bytes] of [
      [
        'Pathway/attributes',
        '009db4b6cb8deba9925ced5bb4bf933e62a2ffe9c5c218bef4089f02bb1bec86',
        5526,
      ],
      [
        'Pathway/referrals',
        '09950303288a8a482850c7386fff022a2e3c2c0db4959118e8910140956ae702',
        390,
      ],
      [
        'EntityWithAccessionedSequence/attributes',
        'b1627bdce648b9594dbcb864611aed8c92360ad31a0a9e8affb2fdb83268e392',
        undefined,
      ],
      [
        'EntityWithAccessionedSequence/referrals',
        'b86d05805c5a9efaf135cecce067204c94c83f979d7d2c790f4b4effc3d5b1a4',
        undefined,
      ],
      [
        'DatabaseObject/attributes',
        'd71208bbe636e76d6c237f42a703d187d8fac3c611969c7b6bb9d2bf5b81ccda',
        undefined,
      ],
      [
        'DatabaseObject/referrals',
        'ed2053fed634c6ce67dbb1ff448c00ba4ecaff9fbcaab43ddef2da91f821aaba',
        136,
      ],
      // Person overrides DatabaseObject's created and modified, so it has two
      // rows of each name: the only class whose order rests on the second sort
      // key, the declaring class (DatabaseObject before Person).
      [
        'Person/attributes',
        '1ce5c6f49fa346eb703099cbea055d52bb6fbccd104b2b0cbac4e5816053a17c',
        1884,
      ],
      ['Person/referrals', 'c9ce7b4c974487467c14a47f4bc184c638178e3234d7096129bdabceabc161cc', 365],
    ]) {
      const answer = await text(path);
      expect(answer.status, path).toBe(200);
      expect(answer.type, path).toMatch(/^application\/json/);
      if (bytes) expect(answer.body.length, path).toBe(bytes);
      expect(sha(answer.body), path).toBe(digest);
    }
  });

  it('answers an interface from its own methods only, as getSuperclass is null', async () => {
    expect((await text('Trackable/attributes')).body).toBe(
      '[{"name":"updateTrackers","cardinality":"+","valueTypes":[{"name":"UpdateTracker","databaseObject":true}],"origin":"Trackable"}]'
    );
    expect((await text('Trackable/referrals')).body).toBe(
      '[{"name":"updatedInstance","cardinality":"+","valueTypes":[{"name":"Trackable","databaseObject":false}],"origin":"UpdateTracker"}]'
    );
  });

  it("answers a woven closure as AspectJ's AroundClosure", async () => {
    expect((await text('Pathway$AjcClosure5/attributes')).body).toBe(
      '[{"name":"flags","cardinality":"1","valueTypes":[{"name":"int","databaseObject":false}],"origin":"AroundClosure"},' +
        '{"name":"preInitializationState","cardinality":"1","valueTypes":[{"name":"Object[]","databaseObject":false}],"origin":"AroundClosure"},' +
        '{"name":"state","cardinality":"1","valueTypes":[{"name":"Object[]","databaseObject":false}],"origin":"AroundClosure"}]'
    );
    const referrals = await text('Pathway$AjcClosure5/referrals');
    expect([referrals.status, referrals.body]).toEqual([200, '[]']);
  });

  it('reads the class as Spring hands it over, a query ignored', async () => {
    const plain = await text('Pathway/attributes');
    expect((await text('Pathway/attributes?x=1')).body).toBe(plain.body);
  });

  it("answers a name Java's Class.forName does not find with its 500", async () => {
    for (const [path, url] of [
      ['Foo/attributes', 'Foo/attributes'],
      ['Foo/attributes?x=1', 'Foo/attributes'],
      ['Foo/referrals', 'Foo/referrals'],
      ['pathway/attributes', 'pathway/attributes'],
      ['Pathway%3Bx/attributes', 'Pathway%3Bx/attributes'],
      ['Pathway.json/attributes', 'Pathway.json/attributes'],
      ['Pathway$AjcClosure1/referrals', 'Pathway$AjcClosure1/referrals'],
      ['Object/attributes', 'Object/attributes'],
      ['model/attributes', 'model/attributes'],
      ['model/referrals', 'model/referrals'],
      ['%1F%0B/attributes', '%1F%0B/attributes'],
    ]) {
      const answer = await text(path);
      expect(answer.status, path).toBe(500);
      expect(answer.type, path).toMatch(/^application\/json/);
      expect(answer.body, path).toBe(classNotFound(url));
    }
  });
});

describe("/schema/model's query", () => {
  it("is graph-core SchemaRepository's, kept as written", () => {
    expect(schemaModelQuery).toBe(
      'MATCH (n:DatabaseObject) RETURN DISTINCT LABELS(n) AS labels, Count(n) AS count'
    );
  });
});

describe('the order endpoints are registered in', () => {
  // app() registers them in array order, and Express takes the first match:
  // a /x/{id} listed before /x/model answered /x/model as if "model" were an
  // id -- the schema browser's class tree, as a 400 about a missing page.
  // Spring ranks a literal segment above a variable; this keeps node doing so.
  const pattern = (path) =>
    new RegExp(
      `^${path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, '[^/]+')}$`
    );
  for (const endpoint of endpoints.filter((e) => !e.path.includes('{')))
    it(`lets ${endpoint.method ?? 'get'} ${endpoint.path} reach its own handler`, () => {
      const first = endpoints.find(
        (e) =>
          (e.method ?? 'get') === (endpoint.method ?? 'get') && pattern(e.path).test(endpoint.path)
      );
      expect(first?.path).toBe(endpoint.path);
    });
});

describe('endpointFor, which endpoint a concrete path belongs to', () => {
  // The diff harness judges a path by its endpoint's declared differences.
  // Matching on the text before the first `{` gave every /schema/{id}/... path
  // to the first of them, /count.
  it('matches the whole template, not its prefix', () => {
    expect(endpointFor('/ContentService/data/schema/Pathway/min')?.path).toBe(
      '/ContentService/data/schema/{id}/min'
    );
    expect(endpointFor('/ContentService/data/schema/Pathway/count?species=9606')?.path).toBe(
      '/ContentService/data/schema/{id}/count'
    );
    expect(endpointFor('/ContentService/data/query/70486/stId')?.path).toBe(
      '/ContentService/data/query/{id}/stId'
    );
    expect(endpointFor('/ContentService/data/query/R-HSA-70486?view=nested')?.path).toBe(
      '/ContentService/data/query/{id}'
    );
    expect(endpointFor('/ContentService/data/query/R-HSA-6802957/normalPathway')?.path).toBe(
      '/ContentService/data/query/{id}/normalPathway'
    );
  });

  it('matches nothing for a path no endpoint serves', () => {
    expect(endpointFor('/ContentService/data/schema/Pathway/attributesAll')).toBeUndefined();
    expect(endpointFor('/ContentService/data/query/70486/stId/extra')).toBeUndefined();
  });
});

describe('fingerprintFiles, what /health hashes', () => {
  it('takes the service modules and its data, sorted, and no specs or notes', () => {
    expect(
      fingerprintFiles([
        'service.mjs',
        'service.spec.mjs',
        'schema-snapshot.json',
        'CACHING.md',
        'graph.mjs',
        'schema.spec.mjs',
      ])
    ).toEqual(['graph.mjs', 'schema-snapshot.json', 'service.mjs']);
  });

  it('takes a module renamed to .ts, and leaves its spec out (spec 013)', () => {
    expect(
      fingerprintFiles([
        'graph.ts',
        'graph.spec.ts',
        'graph.d.ts',
        'service.mjs',
        'domain-snapshot.json',
      ])
    ).toEqual(['domain-snapshot.json', 'graph.ts', 'service.mjs']);
  });
});

describe('writeResult, how a handler answer goes on the wire', () => {
  function recorder() {
    const calls = [];
    const response = {
      status: (s) => (calls.push(['status', s]), response),
      type: (t) => (calls.push(['type', t]), response),
      send: (b) => (calls.push(['send', b]), response),
      end: () => (calls.push(['end']), response),
    };
    return { response, calls };
  }

  it('writes an object body as Jackson would, upper-case escapes included', () => {
    const { response, calls } = recorder();
    writeResult(response, { status: 200, body: { a: '\u001f' } });
    expect(calls).toEqual([
      ['status', 200],
      ['type', 'application/json'],
      ['send', '{"a":"\\u001F"}'],
    ]);
  });

  it('sends a string as it is, a serialised body as given, and no body at all as nothing', () => {
    let rec = recorder();
    writeResult(rec.response, { status: 200, body: 'R-HSA-1', type: 'text/plain' });
    expect(rec.calls.at(-1)).toEqual(['send', 'R-HSA-1']);
    rec = recorder();
    writeResult(rec.response, { status: 200, body: [1], serialised: '[1]' });
    expect(rec.calls.at(-1)).toEqual(['send', '[1]']);
    rec = recorder();
    writeResult(rec.response, { status: 200, body: undefined });
    expect(rec.calls).toEqual([['status', 200], ['end']]);
  });
});

describe('topPathwayJson, a top-level pathway as Java writes it', () => {
  // Java's key order for /pathways/top/9606, 14 Oct 2026: releaseStatus before
  // speciesName, and doi after species -- node had them the other way about.
  it("writes Java's keys in Java's order", () => {
    const pathway = {
      dbId: 1,
      displayName: 'd',
      stId: 'R-HSA-1',
      stIdVersion: 'R-HSA-1.1',
      isInDisease: false,
      isInferred: false,
      maxDepth: 3,
      name: ['d'],
      releaseDate: '2020-01-01',
      releaseStatus: 'UPDATED',
      speciesName: 'Homo sapiens',
      doi: '10.3180/R-HSA-1.1',
      hasDiagram: true,
      hasEHLD: false,
      lastUpdatedDate: '2024-01-01',
      schemaClass: 'TopLevelPathway',
    };
    expect(Object.keys(topPathwayJson(pathway, 48887))).toEqual([
      'dbId',
      'displayName',
      'stId',
      'stIdVersion',
      'isInDisease',
      'isInferred',
      'maxDepth',
      'name',
      'releaseDate',
      'releaseStatus',
      'speciesName',
      'species',
      'doi',
      'hasDiagram',
      'hasEHLD',
      'lastUpdatedDate',
      'schemaClass',
      'className',
    ]);
    expect(topPathwayJson(pathway, 48887).species).toEqual([48887]);
  });
});

describe('topSpeciesMatch, how /pathways/top reads its species', () => {
  // graph-core's TopLevelPathwayService: StringUtils.isNumeric is a taxId,
  // anything else an exact displayName. Measured against Java, 14 Oct 2026:
  // "Homo sapiens" answers, "homo sapiens" and "Homo_sapiens" are 404s.
  it('reads digits as a taxId', () => {
    expect(topSpeciesMatch('9606')).toEqual({
      where: 's.taxId = $species',
      params: { species: '9606' },
    });
  });

  it('reads anything else as an exact display name, case and all', () => {
    expect(topSpeciesMatch('Homo sapiens')).toEqual({
      where: 's.displayName = $species',
      params: { species: 'Homo sapiens' },
    });
    expect(topSpeciesMatch('homo_sapiens').params.species).toBe('homo_sapiens');
  });
});

describe('javaUrlDecode, java.net.URLDecoder.decode(s, "UTF-8")', () => {
  // /pathways/top decodes its species a second time, as content-service's
  // controller does, so Homo+sapiens and Homo%2520sapiens find human. Each
  // case measured against Java, 14 Oct 2026.
  it('turns + into a space and decodes %XX as UTF-8', () => {
    expect(javaUrlDecode('Homo+sapiens')).toBe('Homo sapiens');
    expect(javaUrlDecode('Homo%20sapiens')).toBe('Homo sapiens');
    expect(javaUrlDecode('Homo%2Bsapiens')).toBe('Homo+sapiens');
    expect(javaUrlDecode('%C3%A9')).toBe('é');
    expect(javaUrlDecode('9606')).toBe('9606');
  });

  it("throws Java's messages for an incomplete or non-hex escape", () => {
    for (const raw of ['%', 'a%', '%%', '%1']) {
      expect(() => javaUrlDecode(raw), raw).toThrow(
        'URLDecoder: Incomplete trailing escape (%) pattern'
      );
    }
    expect(() => javaUrlDecode('%zz')).toThrow(
      'URLDecoder: Illegal hex characters in escape (%) pattern - Error at index 0 in: "zz"'
    );
  });
});

describe('a matrix parameter', () => {
  // Java drops ';...' from each segment; nothing sends one on purpose, and
  // every way of writing a URL is one more to cache, so here it is Spring's
  // 404 for a path nothing maps (decided 18 Oct 2026, spec 006 T008). An
  // encoded ';' is part of the id, as it is to Java.
  it("is Spring's 404, on any segment, before any endpoint runs", async () => {
    for (const path of [
      'data;jsessionid=x/diseases',
      'data/pathways/top/9606;x',
      'data/query/R-HSA-70486;x/displayName',
      'data/schema/Pathway;x/attributes',
      'data/query/ids;x=1',
    ]) {
      const response = await fetch(`${base}/ContentService/${path}`);
      const body = await response.json();
      expect([path, response.status, body.error, body.path]).toEqual([
        path,
        404,
        'Not Found',
        `/ContentService/${path}`,
      ]);
    }
  });

  it("is not a ';' in the query string, nor an encoded one", async () => {
    // /pathways/top reads its species with URLDecoder: '%' alone is Java's
    // 500 before any query, so neither form reaches the graph.
    for (const path of ['data/pathways/top/%25?a=1;b=2', 'data/pathways/top/%25%3Bx']) {
      const response = await fetch(`${base}/ContentService/${path}`);
      expect([path, response.status]).toEqual([path, 500]);
      // Java's own 500 for each: the escape, not a missing mapping.
      expect(await response.text()).toContain('URLDecoder: ');
    }
  });
});
