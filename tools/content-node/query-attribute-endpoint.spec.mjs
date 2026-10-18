// @vitest-environment node
//
// /data/query/{id}/{attributeName} and /data/person/{id}/{attributeName}
// through the service, with a stand-in graph: the object findById loads, then
// what LazyFetchAspect would load for a getter whose relationship is empty.
// The objects here are invented; Java's answers were measured 18 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root;
let lazy = {};
const asked = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher) => {
    asked.push(cypher);
    if (/RETURN labels\(n\) AS labels/.test(cypher)) return root ? [{ labels: root.labels }] : [];
    if (/AS root/.test(cypher))
      return root ? [{ root, order: [], nodes: [], relationships: [] }] : [];
    for (const [type, rows] of Object.entries(lazy))
      if (cypher.includes(`[r:${type}]`)) return rows;
    return [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./service.mjs');

let base;
let server;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const get = (path) => fetch(`${base}/ContentService/data/${path}`);
const messages = async (response) => [response.status, (await response.json()).messages];
const pathway = {
  id: 1,
  labels: ['DatabaseObject', 'Event', 'Pathway'],
  props: { dbId: 9, stId: 'R-HSA-9', displayName: 'P', schemaClass: 'Pathway' },
};
const loaded = (id, schemaClass, labels, n = null) => ({
  m: {
    id,
    labels: ['DatabaseObject', ...labels],
    props: { dbId: id, stId: `R-HSA-${id}`, displayName: `o${id}`, schemaClass },
  },
  n,
});

describe('a single object loaded lazily', () => {
  it("is the one there is, asked for by the getter's class", async () => {
    root = pathway;
    lazy = { modified: [loaded(20, 'InstanceEdit', ['InstanceEdit'])] };
    asked.length = 0;
    const response = await get('query/R-HSA-9/modified');
    expect([response.status, await response.text()]).toEqual([200, 'R-HSA-20\to20\tInstanceEdit']);
    expect(asked.find((cypher) => cypher.includes('[r:modified]'))).toMatch(/\(m:InstanceEdit\)/);
  });

  it("is nothing when there are two, as findByRelationship gives: Java's 404", async () => {
    root = pathway;
    lazy = {
      modified: [
        loaded(20, 'InstanceEdit', ['InstanceEdit']),
        loaded(21, 'InstanceEdit', ['InstanceEdit']),
      ],
    };
    expect(await messages(await get('query/R-HSA-9/modified'))).toEqual([
      404,
      ["Attribute: 'modified' has not been found for object: Pathway"],
    ]);
  });
});

describe('a collection loaded lazily', () => {
  it('lists each object as many times as its stoichiometry', async () => {
    root = {
      id: 2,
      labels: ['DatabaseObject', 'PhysicalEntity', 'Complex'],
      props: { dbId: 5, stId: 'R-HSA-5', displayName: 'C', schemaClass: 'Complex' },
    };
    lazy = { hasComponent: [loaded(30, 'Complex', ['PhysicalEntity', 'Complex'], 2)] };
    const response = await get('query/R-HSA-5/componentOf');
    expect(await response.text()).toBe('R-HSA-30\to30\tComplex\nR-HSA-30\to30\tComplex\n');
  });
});

describe("Java's other answers", () => {
  it("leaves Java's own /query/abridged/{id}, /query/enhanced/{id} and /query/{id}/more alone", async () => {
    root = pathway;
    for (const path of ['query/abridged/R-HSA-9', 'query/R-HSA-9/more']) {
      const response = await get(path);
      expect([path, response.status, (await response.json()).error]).toEqual([
        path,
        404,
        'Not Found',
      ]);
    }
  });

  it("is Java's 500 for a getter that fails, and its 404s for no object or no attribute", async () => {
    root = {
      id: 3,
      labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceGeneProduct'],
      props: { dbId: 17, schemaClass: 'ReferenceGeneProduct' },
    };
    lazy = {};
    const failed = await get('query/17/simplifiedDatabaseName');
    expect([failed.status, (await failed.json()).reason]).toEqual([500, 'INTERNAL_SERVER_ERROR']);
    expect(await messages(await get('query/17/xyz'))).toEqual([
      404,
      ["Attribute: 'xyz' has not been found for object: ReferenceGeneProduct"],
    ]);
    root = undefined;
    expect(await messages(await get('query/R-HSA-0/displayName'))).toEqual([
      404,
      ['Id: R-HSA-0 has not been found in the System'],
    ]);
  });
});

describe('/data/person/{id}/{attributeName}', () => {
  it('reads the id as a path variable, matrix parameter cut, and names a person not found', async () => {
    root = {
      id: 4,
      labels: ['DatabaseObject', 'Person'],
      props: { dbId: 68285, displayName: 'D', schemaClass: 'Person' },
    };
    asked.length = 0;
    const response = await get('person/68285;x=1/displayName');
    expect([response.status, await response.text()]).toEqual([200, 'D']);
    root = undefined;
    expect(await messages(await get('person/68286/displayName'))).toEqual([
      404,
      ['No person found for id: 68286'],
    ]);
  });
});
