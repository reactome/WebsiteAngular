// @vitest-environment node
//
// /data/instance/{id}/referrers -- what points at an object, for the
// website's detail pages -- with a stand-in graph: graph-core's
// ReferralsLinkageRepository.getReferralsTo, by stable id or dbId, and
// Java's 404 and 500. The answers' shapes are Java's, compared live on 17 Oct
// 2026; the graph here is invented.
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

const asked = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    // findNewStId: REACT_1 became R-HSA-9; REACT_2 became nothing.
    if (cypher.includes('oldStId')) return params.id === 'REACT_1' ? [{ stId: 'R-HSA-9' }] : [];
    if (params.id === 'R-HSA-0') return [];
    if (params.id === 'R-HSA-5')
      return [
        {
          referral: 'input',
          objects: [
            { dbId: 1, stId: null, displayName: null, schemaClass: null },
            { dbId: 2, stId: '', displayName: '', schemaClass: '' },
          ],
        },
      ];
    return [
      {
        referral: 'hasComponent',
        objects: [
          {
            schemaClass: 'Complex',
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
            schemaClass: 'UpdateTracker',
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
    // graph-core's exclusions, all seven, and no edit history.
    expect(asked[0][0]).toContain('NOT ref:InstanceEdit');
    // The class from the node's own property, as SimpleDatabaseObject.build(Value) reads it.
    expect(asked[0][0]).toContain('schemaClass: ref.schemaClass');
    expect(asked[0][0]).toContain(
      'NOT (d)<-[:species|compartment|includedLocation|referenceDatabase|evidenceType|reviewStatus|previousReviewStatus]-(ref)'
    );
    // Groups by relationship, each once, at most 1000.
    expect(asked[0][0]).toMatch(/RETURN DISTINCT TYPE\(rel\) AS referral,/);
    expect(asked[0][0]).toMatch(/LIMIT 1000$/);
    expect(asked[0][1]).toEqual({ id: 'R-HSA-141433' });
  });

  it("is Java's 500 for a dbId past a long's range, as Long.parseLong refuses it", async () => {
    asked.length = 0;
    for (const id of ['99999999999999999999', '99999999999999999999.1']) {
      const response = await get(id);
      expect([response.status, (await response.json()).messages]).toEqual([
        500,
        ['For input string: "99999999999999999999"'],
      ]);
    }
    // Java echoes the id as given, trimmed and its version cut: here
    // Arabic-Indic digits, which StringUtils.isNumeric takes as digits.
    const arabic = '\u0669'.repeat(20);
    const echoed = await fetch(
      `${base}/ContentService/data/instance/%20${encodeURIComponent(arabic)}.1%20/referrers`
    );
    expect((await echoed.json()).messages).toEqual([`For input string: "${arabic}"`]);
    // One past the largest long.
    const past = await get('9223372036854775808');
    expect((await past.json()).messages).toEqual(['For input string: "9223372036854775808"']);
    expect(asked).toHaveLength(0);
    const largest = await get('9223372036854775807');
    expect(largest.status).toBe(200);
  });

  it('answers with a trailing slash, as Spring matches one', async () => {
    const response = await fetch(`${base}/ContentService/data/instance/R-HSA-0/referrers/`);
    expect([response.status, await response.text()]).toEqual([200, '[]']);
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
    expect([bad.status, await bad.text()]).toEqual([
      404,
      `{"code":404,"reason":"NOT_FOUND","url":"${base}/ContentService/data/instance/xyz/referrers","messages":["No referrers found for id: xyz"],"targets":null}`,
    ]);
    expect(asked).toHaveLength(0);
  });

  it('finds an old REACT_ id by its new stable id, and keeps it when there is none', async () => {
    asked.length = 0;
    await get('REACT_1.3');
    expect(asked.map(([, params]) => params.id)).toEqual(['REACT_1', 'R-HSA-9']);
    // Then by the new id as a stable id.
    expect(asked[1][0]).toMatch(/\(d:DatabaseObject\{stId:\$id\}\)/);
    asked.length = 0;
    await get('REACT_2');
    expect(asked.map(([, params]) => params.id)).toEqual(['REACT_2', 'REACT_2']);
  });

  it('writes what a node lacks as Java does: "null" for no name or class, nothing for an empty one', async () => {
    const response = await get('R-HSA-5');
    expect(await response.text()).toBe(
      '[{"referral":"input","objects":[{"dbId":1,"displayName":"null","schemaClass":"null"},{"dbId":2}]}]'
    );
  });
});
