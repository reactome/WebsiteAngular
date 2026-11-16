// @vitest-environment node
//
// /data/pathway/{id}/containedEvents and .../containedEvents/{attributeName}
// through the service, with a stand-in graph: graph-core's query, its records
// mapped as findAll maps them, and what a getter loads when asked. The events
// here are invented; Java's answers were measured 18 Oct 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** A query's parameters, as the service passes them. */
type Params = { stId?: unknown; dbId?: unknown; [name: string]: unknown };
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
/** The lazy loads' rows, by `${type} ${direction} ${dbId}`. */
let lazy: Record<string, unknown[]> = {};
const node = (id: number, labels: string[], props: GraphNode['props']): GraphNode => ({
  id,
  labels: ['DatabaseObject', 'Event', ...labels],
  props,
});
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
const hasEvent = (id: number, start: number, end: number, order: number) => ({
  id,
  type: 'hasEvent',
  start,
  end,
  props: { order, stoichiometry: 1 },
});
/** The contained-events query's records, when a test sets its own. */
let records: unknown[] | undefined;
const RECORDS = [
  { e: A, 'COLLECT(r)': [[hasEvent(10, 1, 2, 1)]], 'COLLECT(p)': [P] },
  { e: B, 'COLLECT(r)': [[hasEvent(11, 1, 3, 0)]], 'COLLECT(p)': [P] },
];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params) => {
    asked.push([cypher, params]);
    if (cypher.includes('[r:hasEvent*1..100]'))
      return params.stId === 'R-HSA-100' || params.dbId ? (records ?? RECORDS) : [];
    // A lazy load by what it asks: `${type} ${direction} ${dbId}`, so one in
    // the wrong direction, or of another event, finds nothing.
    const load = /\{dbId:\$dbId\}\)(<-|-)\[r:(\w+)\](->|-)/.exec(cypher);
    if (load)
      return (
        lazy[`${load[2]} ${load[1] === '<-' ? 'INCOMING' : 'OUTGOING'} ${Number(params.dbId)}`] ??
        []
      );
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

/** The last query asked; none at all is the test's failure, not undefined. */
const last = () => {
  const query = asked.at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  return query;
};
const get = (path: string) => fetch(`${base}/ContentService/data/pathway/${path}`);
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];

describe('/data/pathway/{id}/containedEvents', () => {
  it("runs graph-core's query as written, by stable id or dbId, and writes the events", async () => {
    asked.length = 0;
    const written = (await (await get('R-HSA-100/containedEvents')).json()) as (
      number | { dbId: number }
    )[];
    expect(written.map((event) => (typeof event === 'number' ? event : event.dbId))).toEqual([
      200, 300,
    ]);
    expect(last()[0]).toBe(
      'MATCH (p:Pathway)-[r:hasEvent*1..100]->(e:Event) WHERE p.stId = $stId RETURN e, COLLECT(r), COLLECT(p)'
    );
    await get('100/containedEvents');
    expect(last()[0]).toBe(
      'MATCH (p:Pathway)-[r:hasEvent*1..100]->(e:Event) WHERE p.dbId = $dbId RETURN e, COLLECT(r), COLLECT(p)'
    );
    expect(Number(last()[1].dbId)).toBe(100);
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

  it("loads what findAll did not bring, outgoing relationships too, each event's own", async () => {
    const compartment = (id: number, dbId: number, displayName: string) => [
      {
        m: {
          id,
          labels: ['DatabaseObject', 'Compartment'],
          props: { dbId, displayName, schemaClass: 'Compartment' },
        },
        n: null,
      },
    ];
    lazy = {
      'compartment OUTGOING 200': compartment(9, 70101, 'cytosol'),
      'compartment OUTGOING 300': compartment(10, 7660, 'nucleoplasm'),
    };
    const response = await get('R-HSA-100/containedEvents/compartment');
    expect(await response.text()).toBe(
      '[70101\tcytosol\tCompartment\n, 7660\tnucleoplasm\tCompartment\n]'
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
