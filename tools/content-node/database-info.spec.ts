// @vitest-environment node
//
// /data/database/info through the service, with a stand-in graph (spec 006
// T106): graph-core's DBInfo, mapped and written as Java writes a domain
// object, read once and held; a failed read not held. Java's answer, measured
// 12 Nov 2026, is the shape; the values here are invented.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked: string[] = [];
let failing = true;
vi.mock('./graph.ts', () => ({
  read: async (cypher: string) => {
    if (!cypher.includes('(db:DBInfo)')) return [];
    asked.push(cypher);
    if (failing) throw new Error('the database is not there yet');
    return [
      {
        db: {
          id: 1,
          labels: ['DatabaseObject', 'Release', 'DBInfo'],
          props: {
            dbId: 7,
            displayName: '90 on 2025-01-01',
            releaseDate: '2025-01-01',
            releaseNumber: 90,
            name: 'reactome',
            checksum: 123456789012,
            schemaClass: 'DBInfo',
          },
        },
      },
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

const get = (query = '') => fetch(`${base}/ContentService/data/database/info${query}`);

describe('/data/database/info', () => {
  it('does not hold a failed read: the next request reads again', async () => {
    expect((await get()).status).toBe(500);
    failing = false;
    expect((await get()).status).toBe(200);
    expect(asked).toHaveLength(2);
  });

  it("writes DBInfo in Jackson's order, with getVersion's releaseNumber", async () => {
    const response = await get();
    expect(await response.text()).toBe(
      '{"dbId":7,"displayName":"90 on 2025-01-01","releaseDate":"2025-01-01","releaseNumber":90,' +
        '"name":"reactome","checksum":123456789012,"version":90,"className":"DBInfo","schemaClass":"DBInfo"}'
    );
  });

  it('gives it a JSOG id with includeRef, and reads the graph no more', async () => {
    const text = await (await get('?includeRef=true')).text();
    expect(text.startsWith('{"@id":"1","dbId":7,')).toBe(true);
    expect(asked).toHaveLength(2);
  });
});
