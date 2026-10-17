// @vitest-environment node
//
// /data/entity/{id}/componentOf -- what an entity or event is part of: the
// complexes, sets and reactions above it, grouped by the relationship -- with
// a stand-in graph. PhysicalEntityController over graph-core's
// ComponentOfLinkageRepository, whose query is kept as written; rows come in
// the order Neo4j gives them, unsorted, as in Java. The rows here are invented.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked = [];
let rows = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    return rows;
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

const get = (id) => fetch(`${base}/ContentService/data/entity/${id}/componentOf`);
const last = () => asked[asked.length - 1];
const oneLine = (cypher) => cypher.replace(/\s+/g, ' ').trim();

describe('/data/entity/{id}/componentOf', () => {
  it("runs graph-core's query as written and writes each group as Java does", async () => {
    rows = [
      {
        type: 'output',
        schemaClasses: ['Reaction', ''],
        names: ['B', 'A'],
        stIds: ['R-HSA-2', ''],
        species: ['Homo sapiens', ''],
      },
      {
        type: 'hasComponent',
        schemaClasses: ['Complex'],
        names: ['C'],
        stIds: ['R-HSA-3'],
        species: ['Homo sapiens'],
      },
    ];
    asked.length = 0;
    const response = await get('R-HSA-1');
    expect(await response.text()).toBe(
      '[{"type":"output","names":["B","A"],"stIds":["R-HSA-2",""],"schemaClasses":["Reaction",""],"species":["Homo sapiens",""]},' +
        '{"type":"hasComponent","names":["C"],"stIds":["R-HSA-3"],"schemaClasses":["Complex"],"species":["Homo sapiens"]}]'
    );
    expect(oneLine(last()[0])).toBe(
      "MATCH (n:DatabaseObject{stId: $id})<-[r:hasEvent|input|output|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker]-(m) RETURN DISTINCT(TYPE(r)) AS type, COLLECT(COALESCE(m.schemaClass, '')) AS schemaClasses, COLLECT(COALESCE(m.displayName, '')) AS names, COLLECT(COALESCE(m.stId, '')) AS stIds, COLLECT(COALESCE(m.speciesName, '')) as species"
    );
    expect(last()[1]).toEqual({ id: 'R-HSA-1' });
  });

  it('reads the id as Spring reads a path variable: decoded, a matrix parameter cut', async () => {
    rows = [
      {
        type: 'input',
        schemaClasses: ['Reaction'],
        names: ['A'],
        stIds: ['R-HSA-2'],
        species: ['H'],
      },
    ];
    asked.length = 0;
    await get('R-HSA-69620;x=1');
    expect(last()[1]).toEqual({ id: 'R-HSA-69620' });
  });

  it('matches a dbId as a number', async () => {
    rows = [
      {
        type: 'input',
        schemaClasses: ['Reaction'],
        names: ['A'],
        stIds: ['R-HSA-2'],
        species: ['H'],
      },
    ];
    asked.length = 0;
    await get('199420');
    expect(oneLine(last()[0])).toMatch(/^MATCH \(n:DatabaseObject\{dbId: toInteger\(\$id\)\}\)<-/);
  });

  it('is a 404 naming the id, for one that is neither or is part of nothing', async () => {
    rows = [];
    for (const id of ['xyz', 'R-HSA-162582']) {
      const response = await get(id);
      const body = await response.json();
      expect([id, response.status, body]).toEqual([
        id,
        404,
        {
          code: 404,
          reason: 'NOT_FOUND',
          url: expect.stringMatching(/\/componentOf$/),
          messages: [`Id: ${id} has not been found in the System`],
          targets: null,
        },
      ]);
    }
  });
});
