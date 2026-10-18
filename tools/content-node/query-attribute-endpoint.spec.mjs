// @vitest-environment node
//
// /data/query/{id}/{attributeName} through the service, with a stand-in
// graph: the object findById loads, then what LazyFetchAspect would load for
// a getter whose relationship is empty. The objects here are invented; Java's
// answers were measured 18 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let lazyRows = [];
const asked = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push(cypher);
    if (/RETURN labels\(n\) AS labels/.test(cypher))
      return [{ labels: ['DatabaseObject', 'Event', 'Pathway'] }];
    if (/AS root/.test(cypher))
      return [
        {
          root: {
            id: 1,
            labels: ['DatabaseObject', 'Event', 'Pathway'],
            props: { dbId: 9, stId: 'R-HSA-9', displayName: 'P', schemaClass: 'Pathway' },
          },
          order: [],
          nodes: [],
          relationships: [],
        },
      ];
    if (/\[r:modified\]/.test(cypher)) return lazyRows;
    void params;
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

const edit = (id) => ({
  m: {
    id,
    labels: ['DatabaseObject', 'InstanceEdit'],
    props: { dbId: id, displayName: `edit ${id}`, schemaClass: 'InstanceEdit' },
  },
  n: null,
});

describe('a single object loaded lazily', () => {
  it('is the one there is, written as toTSV writes an object', async () => {
    lazyRows = [edit(20)];
    const response = await fetch(`${base}/ContentService/data/query/R-HSA-9/modified`);
    expect([response.status, await response.text()]).toEqual([200, '20\tedit 20\tInstanceEdit']);
  });

  it("is nothing when there are two, as findByRelationship gives: Java's 404", async () => {
    lazyRows = [edit(20), edit(21)];
    const response = await fetch(`${base}/ContentService/data/query/R-HSA-9/modified`);
    expect([response.status, (await response.json()).messages]).toEqual([
      404,
      ["Attribute: 'modified' has not been found for object: Pathway"],
    ]);
  });
});
