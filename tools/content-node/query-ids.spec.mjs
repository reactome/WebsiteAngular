// @vitest-environment node
//
// POST /data/query/ids and /data/query/ids/map -- a batch of objects by id --
// with a stand-in graph, for Java's errors and its answers, and the two
// orders Java writes in: a HashSet of DatabaseObjects and a HashMap of ids.
// The expected orders are the JDK's own (11, the version the service runs),
// computed with graph-core's DatabaseObject.hashCode -- dbId, then stId,
// then displayName, 31 apart. Java's answers measured 17 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Three objects the stand-in graph finds, by the id each is asked by.
const FOUND = {
  'R-HSA-109581': [109581, 'Apoptosis'],
  'R-HSA-1640170': [1640170, 'Cell Cycle'],
  199420: [199420, 'PTEN [cytosol]'],
};
let finds = false;
vi.mock('./graph.ts', () => ({
  read: async (cypher, params) => {
    const known = finds ? FOUND[params?.id] : undefined;
    if (!known) return [];
    const [dbId, displayName] = known;
    const labels = ['DatabaseObject', 'Event', 'Pathway'];
    if (/AS root/.test(cypher))
      return [
        {
          root: {
            id: dbId,
            labels,
            props: { dbId, stId: `R-HSA-${dbId}`, displayName, schemaClass: 'Pathway' },
          },
          order: [],
          nodes: [],
          relationships: [],
        },
      ];
    return [{ labels }];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./service.ts');
const { idKeyedMap } = await import('./data-query-endpoints.ts');
const { databaseObjectSet } = await import('./java-text.ts');

const object = (dbId, stId, displayName) => ({ properties: { dbId, stId, displayName } });

describe('the orders Java writes', () => {
  it("a HashSet of DatabaseObjects, by graph-core's hashCode", () => {
    const objects = [
      object(109581, 'R-HSA-109581', 'Apoptosis'),
      object(1640170, 'R-HSA-1640170', 'Cell Cycle'),
      object(199420, 'R-HSA-199420', 'PTEN [cytosol]'),
      object(69620, 'R-HSA-69620', 'Cell Cycle Checkpoints'),
      object(29358, 'R-ALL-29358', 'ATP [cytosol]'),
      object(5672965, 'R-HSA-5672965', 'RAS GEFs'),
      // Past an int, and with a field missing: Long.hashCode, and 0 for null.
      object(9999999999, 'R-HSA-9', null),
      object(1, null, 'x'),
    ];
    expect(databaseObjectSet(objects).map((o) => o.properties.dbId)).toEqual([
      1640170, 1, 109581, 29358, 5672965, 9999999999, 199420, 69620,
    ]);
  });

  it('keeps one of two equal objects, as a set does', () => {
    const a = object(109581, 'R-HSA-109581', 'Apoptosis');
    expect(databaseObjectSet([a, object(109581, 'R-HSA-109581', 'Apoptosis')])).toHaveLength(1);
  });

  it('a HashMap of the ids as sent', () => {
    const entries = ['R-HSA-109581', '199420', 'REACT_578', 'R-HSA-1640170', '69620', 'xyz'].map(
      (id) => [id, id]
    );
    expect(idKeyedMap(entries).map(([id]) => id)).toEqual([
      '69620',
      'REACT_578',
      'R-HSA-1640170',
      'R-HSA-109581',
      'xyz',
      '199420',
    ]);
  });
});

let base;
let server;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body, type = 'text/plain') =>
  fetch(`${base}/ContentService/data/query/${path}`, {
    method: 'POST',
    headers: type ? { 'content-type': type } : {},
    body,
  });

describe("Java's answers", () => {
  it('writes /ids in the HashSet order, not the order sent; the ids not found left out', async () => {
    finds = true;
    try {
      const response = await post('ids', 'R-HSA-109581, R-HSA-1640170, 199420, xyz');
      expect((await response.json()).map((o) => o.dbId)).toEqual([1640170, 109581, 199420]);
    } finally {
      finds = false;
    }
  });

  it('writes /ids/map keyed by each id as sent, in the HashMap order', async () => {
    finds = true;
    try {
      const response = await post('ids/map', 'R-HSA-109581, R-HSA-1640170, 199420, xyz');
      // Read from the text: JSON.parse would put "199420", a key that looks
      // like an index, first whatever order the answer wrote.
      const text = await response.text();
      expect([...text.matchAll(/"([^"]+)":\{"dbId":(\d+)/g)].map((m) => [m[1], m[2]])).toEqual([
        ['R-HSA-1640170', '1640170'],
        ['R-HSA-109581', '109581'],
        ['199420', '199420'],
      ]);
    } finally {
      finds = false;
    }
  });
});

describe("Java's errors", () => {
  it('refuses a body that is not text/plain, before anything else', async () => {
    const response = await post('ids', 'x', 'application/json');
    expect([response.status, (await response.json()).messages]).toEqual([
      415,
      ["Content type 'application/json' not supported"],
    ]);
  });

  for (const [path, signature] of [
    [
      'ids',
      'public java.util.Collection<org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.QueryObjectController.findByIds(java.lang.String)',
    ],
    [
      'ids/map',
      'public java.util.Map<java.lang.String, org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.QueryObjectController.findByIdsMap(java.lang.String)',
    ],
  ])
    it(`answers a missing body at ${path} with Spring's 422`, async () => {
      const response = await post(path, undefined);
      expect([response.status, (await response.json()).messages]).toEqual([
        422,
        [`Required request body is missing: ${signature}`],
      ]);
    });

  it('names the ids it did not find, as a Java list', async () => {
    for (const path of ['ids', 'ids/map']) {
      const response = await post(path, 'xyz,abc');
      expect([path, response.status, (await response.json()).messages]).toEqual([
        path,
        404,
        ['Ids: [xyz, abc] have not been found in the System'],
      ]);
    }
  });

  it("is Java's 500 for an id of dots, whatever else the body holds", async () => {
    // graph-core's trimId splits on '.', and "." splits to nothing.
    for (const body of ['R-HSA-109581,.', '..', 'x;.']) {
      const response = await post('ids', body);
      expect([body, response.status, (await response.json()).messages]).toEqual([
        body,
        500,
        ['Index 0 out of bounds for length 0'],
      ]);
    }
  });

  it('fails on the first bad id, in order, as Java looks them up one at a time', async () => {
    const dots = await post('ids', '.,99999999999999999999');
    expect((await dots.json()).messages).toEqual(['Index 0 out of bounds for length 0']);
    const long = await post('ids', '99999999999999999999,.');
    expect((await long.json()).messages).toEqual(['For input string: "99999999999999999999"']);
  });

  it("is Java's 500 for a dbId past a long", async () => {
    const response = await post('ids', '99999999999999999999');
    expect([response.status, (await response.json()).messages]).toEqual([
      500,
      ['For input string: "99999999999999999999"'],
    ]);
  });

  it('answers a GET as the attribute route of Java does: no object called "ids"', async () => {
    for (const path of ['ids/map', 'ids/']) {
      const response = await fetch(`${base}/ContentService/data/query/${path}`);
      expect([path, response.status, (await response.json()).messages]).toEqual([
        path,
        404,
        ['Id: ids has not been found in the System'],
      ]);
    }
  });

  it('takes the trailing slash, as Spring does', async () => {
    for (const path of ['ids/', 'ids/map/']) {
      const response = await post(path, 'xyz');
      expect([path, response.status, (await response.json()).messages]).toEqual([
        path,
        404,
        ['Ids: [xyz] have not been found in the System'],
      ]);
    }
  });
});
