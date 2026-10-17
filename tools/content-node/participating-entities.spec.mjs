// @vitest-environment node
//
// /data/participants/{id}/participatingPhysicalEntities -- every physical
// entity taking part in an event, all the way down -- with a stand-in graph.
// ParticipantService over graph-core's
// PhysicalEntityRepository.getParticipatingPhysicalEntities, kept as written.
// The entities here are invented; Java's answers were measured 17 Oct 2026.
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

const get = (id) =>
  fetch(`${base}/ContentService/data/participants/${id}/participatingPhysicalEntities`);
const last = () => asked[asked.length - 1];
const oneLine = (cypher) => cypher.replace(/\s+/g, ' ').trim();

describe('/data/participants/{id}/participatingPhysicalEntities', () => {
  it("runs graph-core's query as written and writes the entities in the rows' order", async () => {
    rows = [
      { m: { dbId: 2, displayName: 'B', schemaClass: 'DefinedSet', isInDisease: false } },
      { m: { dbId: 1, displayName: 'A', schemaClass: 'Complex', isInDisease: false } },
    ];
    asked.length = 0;
    const response = await get('R-HSA-5');
    expect(await response.text()).toBe(
      '[{"dbId":2,"displayName":"B","className":"Set","inDisease":false,"schemaClass":"DefinedSet"},' +
        '{"dbId":1,"displayName":"A","inDisease":false,"schemaClass":"Complex","className":"Complex"}]'
    );
    expect(oneLine(last()[0])).toBe(
      'MATCH (n:DatabaseObject{stId: $id})-[:hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*]->(m:PhysicalEntity) RETURN Distinct(m)'
    );
    expect(last()[1]).toEqual({ id: 'R-HSA-5' });
  });

  it('matches a dbId as a number', async () => {
    rows = [];
    asked.length = 0;
    await get('5');
    expect(oneLine(last()[0])).toMatch(/^MATCH \(n:DatabaseObject\{dbId: toInteger\(\$id\)\}\)-/);
  });

  it("is Java's: [] for nothing found, and a bare 200 for an id that is neither", async () => {
    rows = [];
    const none = await get('R-HSA-5');
    expect([none.status, none.headers.get('content-type'), await none.text()]).toEqual([
      200,
      'application/json; charset=utf-8',
      '[]',
    ]);
    asked.length = 0;
    const neither = await get('xyz');
    expect([neither.status, neither.headers.get('content-type'), await neither.text()]).toEqual([
      200,
      null,
      '',
    ]);
    expect(asked).toEqual([]);
  });
});
