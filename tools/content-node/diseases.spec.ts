// @vitest-environment node
//
// /data/diseases and /data/diseases/doid -- every Disease in the graph, as
// graph-core's SchemaRepository.getByClass reads them (nodes alone, ordered by
// displayName), written whole and as DiseasesController's tab-separated list.
// The diseases here are invented.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked: string[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string) => {
    asked.push(cypher);
    const node = (id: number, props: Record<string, unknown>) => ({
      n: { id, labels: ['DatabaseObject', 'Disease'], props },
    });
    return [
      node(1, {
        dbId: 11,
        displayName: 'A disease',
        databaseName: 'DOID',
        identifier: '0001',
        schemaClass: 'Disease',
      }),
      node(2, {
        dbId: 12,
        displayName: 'B symptom',
        databaseName: 'SYMP',
        identifier: '0002',
        schemaClass: 'Disease',
      }),
      node(3, { dbId: 13, displayName: 'C unnamed', schemaClass: 'Disease' }),
    ];
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

describe('/data/diseases', () => {
  it("asks for every Disease, alone, in graph-core's order", async () => {
    asked.length = 0;
    const response = await fetch(`${base}/ContentService/data/diseases`);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(((await response.json()) as { dbId: number }[]).map((d) => d.dbId)).toEqual([
      11, 12, 13,
    ]);
    expect(asked[0]).toMatch(/MATCH \(n:Disease\)/);
    expect(asked[0]).toMatch(/ORDER BY n\.displayName/);
    // Nodes alone: no relationship is read.
    expect(asked[0]).not.toMatch(/\]-/);
  });

  it('lists them as dbId, then database:identifier, a line each, "null" for what is missing', async () => {
    const response = await fetch(`${base}/ContentService/data/diseases/doid`);
    expect([response.status, response.headers.get('content-type')]).toEqual([
      200,
      'text/plain; charset=utf-8',
    ]);
    expect(await response.text()).toBe('11\tDOID:0001\n12\tSYMP:0002\n13\tnull:null');
  });
});
