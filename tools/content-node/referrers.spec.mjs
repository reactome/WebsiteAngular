// @vitest-environment node
//
// /data/instance/{id}/referrers -- what points at an object, for the
// website's detail pages -- with a stand-in graph: graph-core's
// ReferralsLinkageRepository.getReferralsTo, by stable id or dbId, and
// Java's 404s. Java's answers measured 17 Oct 2026.
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

const asked = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    if (params.id === 'R-HSA-0' || params.id === 0) return [];
    return [
      {
        referral: 'hasComponent',
        objects: [
          {
            labels: ['Complex', 'PhysicalEntity', 'DatabaseObject'],
            dbId: 7,
            stId: 'R-HSA-7',
            displayName: 'A complex',
          },
        ],
      },
      {
        referral: 'updatedInstance',
        objects: [
          {
            labels: ['UpdateTracker', 'DatabaseObject'],
            dbId: 8,
            stId: null,
            displayName: 'An update',
          },
        ],
      },
    ];
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

const get = (id) => fetch(`${base}/ContentService/data/instance/${id}/referrers`);

describe('/data/instance/{id}/referrers', () => {
  it('groups what refers to the object by relationship, each a simple object', async () => {
    asked.length = 0;
    const response = await get('R-HSA-141433');
    expect(await response.text()).toBe(
      '[{"referral":"hasComponent","objects":[{"dbId":7,"stId":"R-HSA-7","displayName":"A complex","schemaClass":"Complex"}]},' +
        '{"referral":"updatedInstance","objects":[{"dbId":8,"displayName":"An update","schemaClass":"UpdateTracker"}]}]'
    );
    expect(asked[0][0]).toMatch(/\(d:DatabaseObject\{stId:\$id\}\)<-\[rel\]-\(ref\)/);
    expect(asked[0][1]).toEqual({ id: 'R-HSA-141433' });
  });

  it('reads a dbId as a dbId, version cut, as graph-core does', async () => {
    asked.length = 0;
    await get('141433.2');
    expect(asked[0][0]).toMatch(/\{dbId:toInteger\(\$id\)\}/);
    expect(asked[0][1]).toEqual({ id: '141433' });
  });

  it('is an empty list when nothing refers to it, and the 404 for no identifier', async () => {
    const none = await get('R-HSA-0');
    expect([none.status, await none.text()]).toEqual([200, '[]']);
    asked.length = 0;
    const bad = await get('xyz');
    expect([bad.status, (await bad.json()).messages]).toEqual([
      404,
      ['No referrers found for id: xyz'],
    ]);
    expect(asked).toHaveLength(0);
  });
});
