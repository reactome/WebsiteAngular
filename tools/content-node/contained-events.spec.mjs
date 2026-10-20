// @vitest-environment node
//
// /data/pathway/{id}/containedEvents and .../containedEvents/{attributeName}
// through the service, with a stand-in graph: graph-core's query, its records
// mapped as findAll maps them, and what a getter loads when asked. The events
// here are invented; Java's answers were measured 18 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked = [];
let lazy = {};
const node = (id, labels, props) => ({ id, labels: ['DatabaseObject', 'Event', ...labels], props });
const P = node(1, ['Pathway'], {
  dbId: 100,
  stId: 'R-HSA-100',
  displayName: 'P',
  schemaClass: 'Pathway',
});
const A = node(2, ['ReactionLikeEvent', 'Reaction'], {
  dbId: 200,
  stId: 'R-HSA-200',
  displayName: 'A',
  schemaClass: 'Reaction',
});
const B = node(3, ['ReactionLikeEvent', 'Reaction'], {
  dbId: 300,
  stId: 'R-HSA-300',
  displayName: 'B',
  schemaClass: 'Reaction',
});
const hasEvent = (id, start, end, order) => ({
  id,
  type: 'hasEvent',
  start,
  end,
  props: { order, stoichiometry: 1 },
});
let records;
const RECORDS = [
  { e: A, 'COLLECT(r)': [[hasEvent(10, 1, 2, 1)]], 'COLLECT(p)': [P] },
  { e: B, 'COLLECT(r)': [[hasEvent(11, 1, 3, 0)]], 'COLLECT(p)': [P] },
];
vi.mock('./graph.ts', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    if (cypher.includes('[r:hasEvent*1..100]'))
      return params.stId === 'R-HSA-100' || params.dbId ? (records ?? RECORDS) : [];
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

const get = (path) => fetch(`${base}/ContentService/data/pathway/${path}`);
const messages = async (response) => [response.status, (await response.json()).messages];

describe('/data/pathway/{id}/containedEvents', () => {
  it("runs graph-core's query as written, by stable id or dbId, and writes the events", async () => {
    asked.length = 0;
    const written = await (await get('R-HSA-100/containedEvents')).json();
    expect(written.map((event) => (typeof event === 'number' ? event : event.dbId))).toEqual([
      200, 300,
    ]);
    expect(asked.at(-1)[0]).toBe(
      'MATCH (p:Pathway)-[r:hasEvent*1..100]->(e:Event) WHERE p.stId = $stId RETURN e, COLLECT(r), COLLECT(p)'
    );
    await get('100/containedEvents');
    expect(asked.at(-1)[0]).toBe(
      'MATCH (p:Pathway)-[r:hasEvent*1..100]->(e:Event) WHERE p.dbId = $dbId RETURN e, COLLECT(r), COLLECT(p)'
    );
    expect(Number(asked.at(-1)[1].dbId)).toBe(100);
  });

  it('is a 404 naming the id for none', async () => {
    expect(await messages(await get('R-HSA-9/containedEvents'))).toEqual([
      404,
      ['No contained events found in the given event: R-HSA-9'],
    ]);
  });

  it("is Java's 500 for an id of dots and a dbId past a long, before asking anything", async () => {
    asked.length = 0;
    expect(await messages(await get('.../containedEvents'))).toEqual([500, [null]]);
    // Spring trims a path variable: dots inside spaces are dots.
    expect(await messages(await get('%20.%20/containedEvents/stId'))).toEqual([500, [null]]);
    expect(await messages(await get('99999999999999999999/containedEvents'))).toEqual([
      500,
      ['For input string: "99999999999999999999"'],
    ]);
    // 2^64 + 100: wrapped round, it would be pathway 100.
    expect((await get('18446744073709551716/containedEvents/stId')).status).toBe(500);
    expect(asked).toEqual([]);
  });
});

describe('/data/pathway/{id}/containedEvents/{attributeName}', () => {
  it("writes each event's attribute as Java's List.toString does", async () => {
    const response = await get('R-HSA-100/containedEvents/stId');
    expect(await response.text()).toBe('[R-HSA-200, R-HSA-300]');
  });

  it('loads what findAll did not bring, outgoing relationships too', async () => {
    lazy = {
      compartment: [
        {
          m: {
            id: 9,
            labels: ['DatabaseObject', 'Compartment'],
            props: { dbId: 70101, displayName: 'cytosol', schemaClass: 'Compartment' },
          },
          n: null,
        },
      ],
    };
    const response = await get('R-HSA-100/containedEvents/compartment');
    expect(await response.text()).toBe(
      '[70101\tcytosol\tCompartment\n, 70101\tcytosol\tCompartment\n]'
    );
    lazy = {};
  });

  it("is Java's 404 naming the first event without the attribute, not the first event", async () => {
    // A subpathway has hasEvent; the reaction after it does not.
    const sub = node(4, ['Pathway'], {
      dbId: 400,
      stId: 'R-HSA-400',
      displayName: 'S',
      schemaClass: 'Pathway',
    });
    records = [
      { e: sub, 'COLLECT(r)': [[hasEvent(12, 1, 4, 0)]], 'COLLECT(p)': [P] },
      { e: A, 'COLLECT(r)': [[hasEvent(10, 1, 2, 1)]], 'COLLECT(p)': [P] },
    ];
    expect(await messages(await get('R-HSA-100/containedEvents/hasEvent'))).toEqual([
      404,
      ["Attribute: 'hasEvent' has not been found for object: Reaction"],
    ]);
    records = undefined;
  });
});
