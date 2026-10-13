// @vitest-environment node
//
// What can be checked without a database.
//
// This service had no handler-level test at all, which is the gap that let a
// `ReferenceError` reach the render service's first request and pass every
// gate. content-node is the one answering beta's traffic, so it had the same
// hole with more at stake.
//
// Most endpoints need Neo4j and belong to `diff.mjs`, which compares them
// against Java. What is checkable here is everything that is *not* a query: the
// endpoint table's own integrity, and the pure functions a declared difference
// is built from.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app, endpoints, eventProjection, pathId, resolveId } from './service.mjs';

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
    // other's sort. Both orders are proven against Java by `diff.mjs`, which
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

  it('matches nothing for an id Java would not find, lower case included', () => {
    // Java's trim leaves a no-break space or a line separator in place.
    for (const raw of ['abc', 'r-hsa-70486', '', '\u00a070486', '\u202870486']) {
      expect(resolveId(raw).where).toBe('false');
    }
  });
});

describe('pathId, the id as Spring hands it to a controller', () => {
  it('drops what follows a semicolon, as Spring does before matching', () => {
    expect(pathId('70486;x')).toBe('70486');
    expect(pathId('R-HSA-70486;jsessionid=1;a=b')).toBe('R-HSA-70486');
  });

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
