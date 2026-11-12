// @vitest-environment node
//
// /data/diagram/{id}/entities/{identifier} through the service, with a
// stand-in graph (spec 006 T106): graph-core's two lookups, the diagram's
// entities and the given pathways', gathered in a HashSet and written in its
// order; the ids read as graph-core and the controller read them, with
// Java's 500s; the `pathways` list as Spring binds it and the controller cuts
// it. The objects here are invented; Java's answers were measured 12 Nov 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import neo4j from 'neo4j-driver';

/** A query's parameters, as the service passes them. */
type Params = { [name: string]: unknown };
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
/** The rows of the diagram query and of the pathways queries, by kind of id. */
let diagramRows: unknown[] = [];
let byStIdRows: unknown[] = [];
let byDbIdRows: unknown[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params) => {
    asked.push([cypher, params]);
    if (cypher.includes('(t:Pathway{')) return diagramRows;
    if (cypher.includes('p.stId IN $stIds')) return byStIdRows;
    if (cypher.includes('p.dbId IN $stIds')) return byDbIdRows;
    // getIdentifier's findNewStId: REACT_1 became R-HSA-1.
    if (cypher.includes('n.oldStId = $id'))
      return params['id'] === 'REACT_1' ? [{ stId: 'R-HSA-1' }] : [];
    return [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./server.ts');

let base: string;
let server: Server;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  asked.length = 0;
  diagramRows = [];
  byStIdRows = [];
  byDbIdRows = [];
});

const get = (path: string) => fetch(`${base}/ContentService/data/diagram/${path}`);
/** The messages of Java's error envelope. */
const messages = async (response: Response) =>
  ((await response.json()) as { messages: string[] }).messages;
const row = (dbId: number, labels = ['DatabaseObject', 'PhysicalEntity', 'Complex']) => ({
  dbId,
  stId: `R-HSA-${dbId}`,
  displayName: `E${dbId}`,
  labels,
});
const dbIds = async (response: Response) =>
  ((await response.json()) as { dbId: number }[]).map((object) => object.dbId);
const diagramQuery = () => asked.find(([cypher]) => cypher.includes('(t:Pathway{'));

describe("the answer, a HashSet's order", () => {
  it('writes each object as SimpleDatabaseObject, its class from its labels', async () => {
    diagramRows = [
      row(5),
      { dbId: 6, stId: null, displayName: 'D', labels: ['DatabaseObject', 'Drug'] },
    ];
    const response = await get('R-HSA-9/entities/x');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '[{"dbId":5,"stId":"R-HSA-5","displayName":"E5","schemaClass":"Complex"},' +
        '{"dbId":6,"displayName":"D","schemaClass":"Drug"}]'
    );
  });

  it("orders by Long.hashCode's bucket, arrivals in order within one", async () => {
    // 16 buckets: 40 is in 8; 19 and 3 in 3, in the order they came; 2^32 + 2
    // folds its high half in (2 ^ 1 = 3), so it is in 3 too, last.
    diagramRows = [row(40), row(19), row(3), row(4294967298)];
    expect(await dbIds(await get('R-HSA-9/entities/x'))).toEqual([19, 3, 4294967298, 40]);
  });

  it("adds the pathways' after the diagram's, a dbId already there once", async () => {
    diagramRows = [row(3)];
    byStIdRows = [row(35, ['DatabaseObject', 'Event', 'Pathway']), row(3)];
    const response = await get('R-HSA-9/entities/x?pathways=R-HSA-35');
    // 35 is in bucket 3 after 3, which the diagram gave first.
    expect(await dbIds(response)).toEqual([3, 35]);
  });
});

describe('the diagram id', () => {
  it('reads a stable id as given, version and all, and upper-cases the identifier', async () => {
    await get('R-HSA-9.4/entities/ctsa');
    const [cypher, params] = diagramQuery() ?? ['', {}];
    expect(cypher).toContain('(t:Pathway{stId:$stId})');
    expect(params).toEqual({ stId: 'R-HSA-9.4', identifier: 'CTSA' });
  });

  it('asks an old id as given, though getIdentifier finds its stable id', async () => {
    await get('REACT_1/entities/x');
    expect(diagramQuery()?.[1]).toEqual({ stId: 'REACT_1', identifier: 'X' });
  });

  it('reads a dbId with Long.parseLong: any digits, as a long', async () => {
    await get('%D9%A1%D9%A2/entities/x');
    const [cypher, params] = diagramQuery() ?? ['', {}];
    expect(cypher).toContain('(t:Pathway{dbId:$dbId})');
    expect(neo4j.isInt(params['dbId'])).toBe(true);
    expect(String(params['dbId'])).toBe('12');
  });

  for (const [id, message] of [
    ['%2012', 'For input string: " 12"'],
    ['12.1', 'For input string: "12.1"'],
    ['99999999999999999999', 'For input string: "99999999999999999999"'],
    ['...', 'Index 0 out of bounds for length 0'],
  ])
    it(`answers ${id} with Java's 500`, async () => {
      const response = await get(`${id}/entities/x`);
      expect(response.status).toBe(500);
      expect(await messages(response)).toEqual([message]);
      expect(diagramQuery()).toBeUndefined();
    });

  it('asks nothing for an id that is neither, and answers 404', async () => {
    const response = await get('xyz/entities/x');
    expect(response.status).toBe(404);
    expect(await messages(response)).toEqual(["No entities with identifier 'x' found for xyz"]);
    expect(diagramQuery()).toBeUndefined();
  });
});

describe('the pathways', () => {
  const notFound = async (query: string) =>
    (await messages(await get(`R-HSA-9/entities/x${query}`)))[0];

  it('names them in the 404 as Spring bound them, repeats dropped', async () => {
    expect(await notFound('')).toBe("No entities with identifier 'x' found for R-HSA-9");
    expect(await notFound('?pathways=')).toBe(
      "No entities with identifier 'x' found for R-HSA-9 nor for pathways []"
    );
    expect(await notFound('?pathways=%20a%20,b,a')).toMatch(/ nor for pathways \[a, b\]$/);
    expect(await notFound('?pathways=a&pathways=b,c&pathways=a')).toMatch(
      / nor for pathways \[a, b,c\]$/
    );
  });

  it("keeps the first twenty past twenty, in a HashSet's order", async () => {
    const many = Array.from({ length: 22 }, (_, at) => `a${at + 1}`).join(',');
    // Measured: Java's message for a1..a22.
    expect(await notFound(`?pathways=${many}`)).toMatch(
      / nor for pathways \[a11, a10, a13, a12, a15, a14, a17, a16, a19, a18, a1, a2, a3, a4, a5, a6, a7, a8, a9, a20\]$/
    );
  });

  it('asks stable ids and dbIds apart, an old id as its stable id, the identifier upper-cased', async () => {
    await get('R-HSA-9/entities/x?pathways=R-HSA-2.3,%2042%20,REACT_1,nothing');
    const byStId = asked.find(([cypher]) => cypher.includes('p.stId IN $stIds'));
    const byDbId = asked.find(([cypher]) => cypher.includes('p.dbId IN $stIds'));
    expect(byStId?.[1]).toEqual({ identifier: 'X', stIds: ['R-HSA-2', 'R-HSA-1'] });
    expect(byDbId?.[1]['identifier']).toBe('X');
    expect((byDbId?.[1]['stIds'] as unknown[]).map(String)).toEqual(['42']);
  });

  it("hands each list over in its HashSet's order, the order the rows then come in", async () => {
    // String.hashCode puts R-HSA-12 in bucket 6, R-HSA-11 in 7; Long's puts
    // 17 in 1, 3 in 3, 42 in 10. Measured: given in the order they came,
    // Java's answers came back in another order.
    await get('R-HSA-9/entities/x?pathways=R-HSA-11,42,R-HSA-12,17,3');
    const byStId = asked.find(([cypher]) => cypher.includes('p.stId IN $stIds'));
    const byDbId = asked.find(([cypher]) => cypher.includes('p.dbId IN $stIds'));
    expect(byStId?.[1]['stIds']).toEqual(['R-HSA-12', 'R-HSA-11']);
    expect((byDbId?.[1]['stIds'] as unknown[]).map(String)).toEqual(['17', '3', '42']);
  });

  it('asks neither for none given', async () => {
    await get('R-HSA-9/entities/x?pathways=');
    expect(asked.some(([cypher]) => cypher.includes('IN $stIds'))).toBe(false);
  });

  for (const [pathways, message] of [
    ['a,...,99999999999999999999', 'Index 0 out of bounds for length 0'],
    ['99999999999999999999.2,...', 'For input string: "99999999999999999999"'],
  ])
    it(`answers ${pathways} with the first id's failure, Java's 500`, async () => {
      const response = await get(`R-HSA-9/entities/x?pathways=${pathways}`);
      expect(response.status).toBe(500);
      expect(await messages(response)).toEqual([message]);
    });
});
