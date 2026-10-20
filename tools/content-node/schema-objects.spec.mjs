// @vitest-environment node
//
// /data/schema/{className} -- one page of a class's objects, whole -- with a
// stand-in graph. SchemaController.getDatabaseObjectsForClassName over
// graph-core's SchemaRepository.getByClass(Class, skip, limit): the same rules
// as /min (springInteger page then offset, Java's 500 for a class it lacks,
// 404 for none), but at most 25 to a page, and the nodes returned whole.
// The objects here are invented.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked = [];
let rows = [];
vi.mock('./graph.ts', () => ({
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

const get = (query) => fetch(`${base}/ContentService/data/schema/${query}`);
const pathway = (id, name) => ({
  n: { dbId: id, stId: `R-HSA-${id}`, displayName: name, schemaClass: 'Pathway' },
  labels: ['DatabaseObject', 'Event', 'Pathway'],
  id,
});

describe('/data/schema/{className}', () => {
  it("runs graph-core's query as written, the node returned whole, and writes the objects", async () => {
    rows = [pathway(2, 'A'), pathway(1, 'B')];
    asked.length = 0;
    const response = await get('Pathway?page=2&offset=10');
    expect((await response.json()).map((o) => o.dbId)).toEqual([2, 1]);
    const [cypher, params] = asked[0];
    expect(cypher).toMatch(/^MATCH \(n:Pathway\) RETURN n, /);
    expect(cypher).toMatch(/ ORDER BY n\.displayName SKIP \$skip LIMIT \$limit$/);
    expect([Number(params.skip), Number(params.limit)]).toEqual([10, 10]);
  });

  it('gives at most 25 to a page', async () => {
    rows = [pathway(1, 'A')];
    asked.length = 0;
    await get('Pathway?page=3&offset=1000');
    expect([Number(asked[0][1].skip), Number(asked[0][1].limit)]).toEqual([50, 25]);
  });

  it('filters by species, by taxId when it is a number', async () => {
    rows = [pathway(1, 'A')];
    asked.length = 0;
    await get('Pathway?page=1&offset=5&species=9606');
    expect(asked[0][0]).toMatch(
      /^MATCH \(s:Species\{taxId:\$taxId\}\)<-\[:species\]-\(n:Pathway\)/
    );
    expect(asked[0][1].taxId).toBe('9606');
  });

  it('answers as Java does: 400 without a page, 500 for a class it lacks, 404 for none', async () => {
    const missing = await get('Pathway?offset=5');
    expect(missing.status).toBe(400);
    const unknown = await get('Nonsense?page=1&offset=5');
    expect(unknown.status).toBe(500);
    rows = [];
    const none = await get('Pathway?page=99&offset=5');
    expect([none.status, (await none.json()).messages]).toEqual([
      404,
      ['No entries found for class: Pathway'],
    ]);
  });
});

describe('/data/schema/{className}/reference', () => {
  it('lists a reference class\'s dbId, identifier and database by identifier, a missing text as Java\'s "null"', async () => {
    rows = [
      { dbId: 2, identifier: '10036', databaseName: 'ChEBI' },
      { dbId: 1, identifier: null, databaseName: '' },
    ];
    asked.length = 0;
    const response = await get('ReferenceMolecule/reference?page=2&offset=3');
    expect(await response.text()).toBe(
      '[{"dbId":2,"identifier":"10036","databaseName":"ChEBI"},{"dbId":1,"identifier":"null"}]'
    );
    const [cypher, params] = asked[0];
    expect(cypher).toBe(
      'MATCH (n:ReferenceMolecule) RETURN n.dbId AS dbId, n.databaseName AS databaseName, n.identifier AS identifier ORDER BY n.identifier SKIP $skip LIMIT $limit'
    );
    expect([Number(params.skip), Number(params.limit)]).toEqual([3, 3]);
  });

  it('takes a species as nothing, and caps a page at 20000', async () => {
    rows = [{ dbId: 1, identifier: 'x', databaseName: 'y' }];
    asked.length = 0;
    await get('ExternalOntology/reference?page=1&offset=50000&species=9606');
    expect(asked[0][0]).not.toMatch(/Species/);
    expect(Number(asked[0][1].limit)).toBe(20000);
  });

  it('is a 404 for a class that is no reference, a 500 for one Java lacks', async () => {
    rows = [{ dbId: 1, identifier: 'x', databaseName: 'y' }];
    const pathway = await get('Pathway/reference?page=1&offset=3');
    expect([pathway.status, (await pathway.json()).messages]).toEqual([
      404,
      ['No entries found for class: Pathway'],
    ]);
    const unknown = await get('Nonsense/reference?page=1&offset=3');
    expect([unknown.status, (await unknown.json()).messages]).toEqual([
      500,
      ['Specified class was not found'],
    ]);
  });
});
