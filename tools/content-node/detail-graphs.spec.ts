// @vitest-environment node
//
// /data/detail/{id}/getSubGraph and /getReverseGraph (spec 006 T107) through
// the service, with a stand-in graph; and the four /direction/... paths, which
// no Java controller maps. graph-core's HierarchyService and
// HierarchyRepository: the queries' text, the paths parsed as parseRaw parses
// them, the tree written as Jackson writes a PathwayBrowserNode. The messages
// are Java's, measured 12 Nov 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** One step of a path, as the queries return it. */
type Step = [
  stId: string | null,
  displayName: string | null,
  hasDiagram: boolean | null,
  speciesName: string | null,
  schemaClass: string | null,
  labels: string[] | null,
  order: number | null,
];
type Row = { db: Step; steps: Step[] | null };

/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Record<string, unknown>][] = [];
/** The rows the stand-in graph answers the tree's query with. */
let rows: Row[] = [];

vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Record<string, unknown>) => {
    asked.push([cypher, params]);
    // graphCoreId's look-up of a REACT_ id: the stable id it became.
    if (cypher.includes('oldStId')) return [{ stId: 'R-HSA-1' }];
    return rows;
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
  rows = [];
});

const get = (path: string) => fetch(`${base}/ContentService/data/detail/${path}`);
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response): Promise<[number, string[]]> => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];
/** The tree's query: the last asked. */
const query = () => {
  const last = asked.at(-1);
  if (!last) throw new Error('the graph was asked nothing');
  return last;
};

const HUMAN = 'Homo sapiens';
const PATHWAY: Step = [
  'R-HSA-1',
  'Pathway A',
  true,
  HUMAN,
  'Pathway',
  ['DatabaseObject', 'Event', 'Pathway'],
  0,
];
const B_REACTION: Step = ['R-HSA-2', 'b reaction', false, HUMAN, 'Reaction', null, 1];
const COMPLEX: Step = ['R-HSA-3', 'e entity', null, HUMAN, 'Complex', null, 0];
const A_REACTION: Step = ['R-HSA-4', 'a reaction', null, HUMAN, 'Reaction', null, 0];
const SMALL: Step = ['R-ALL-5', 'small', null, null, 'SimpleEntity', null, 0];

describe('/detail/{id}/getSubGraph', () => {
  // Paths as Neo4j expands them: a longer one extends the last, any other
  // starts again from the root (parseRaw).
  const PATHS: Step[][] = [
    [B_REACTION],
    [B_REACTION, COMPLEX],
    [A_REACTION],
    [A_REACTION, COMPLEX],
    [SMALL],
  ];
  const complex =
    '{"stId":"R-HSA-3","name":"e entity","species":"Homo sapiens","type":"Complex","diagram":false}';

  it("asks graph-core's query, as written but for the RETURN's shape", async () => {
    rows = [{ db: PATHWAY, steps: null }];
    await get('R-HSA-1/getSubGraph');
    const [cypher, params] = query();
    expect(cypher).toBe(
      'MATCH (n:DatabaseObject{stId:$stId}) OPTIONAL MATCH path=(n)-[:hasEvent|input|output|repeatedUnit|hasMember|hasCandidate|hasComponent*]->(m:DatabaseObject) WITH *, relationships(path) AS r ' +
        'RETURN [n.stId, n.displayName, n.hasDiagram, n.speciesName, n.schemaClass, labels(n), 0] AS db, ' +
        '[rel IN r | [endNode(rel).stId, endNode(rel).displayName, endNode(rel).hasDiagram, endNode(rel).speciesName, endNode(rel).schemaClass, null, rel.order ]] AS steps'
    );
    expect(params).toEqual({ stId: 'R-HSA-1' });
  });

  it('reads a dbId, a version and a REACT_ id as getIdentifier does', async () => {
    rows = [{ db: PATHWAY, steps: null }];
    await get('109581.6/getSubGraph');
    expect(query()[0]).toMatch(/^MATCH \(n:DatabaseObject\{dbId:\$dbId\}\) /);
    expect(String(query()[1]['dbId'])).toBe('109581');
    await get('R-HSA-1.9/getSubGraph');
    expect(query()[1]).toEqual({ stId: 'R-HSA-1' });
    await get('REACT_578/getSubGraph');
    expect(query()[1]).toEqual({ stId: 'R-HSA-1' });
  });

  it('writes the tree as Jackson does: TreeSet order, a shared node in full under each parent', async () => {
    rows = PATHS.map((steps) => ({ db: PATHWAY, steps }));
    const response = await get('R-HSA-1/getSubGraph');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    // By species ('' for none, first), then order, then name; `diagram` false
    // written, a missing species and empty children left out.
    expect(await response.text()).toBe(
      '{"stId":"R-HSA-1","name":"Pathway A","species":"Homo sapiens","type":"Pathway","diagram":true,"children":[' +
        '{"stId":"R-ALL-5","name":"small","type":"SimpleEntity","diagram":false},' +
        `{"stId":"R-HSA-4","name":"a reaction","species":"Homo sapiens","type":"Reaction","diagram":false,"children":[${complex}]},` +
        `{"stId":"R-HSA-2","name":"b reaction","species":"Homo sapiens","type":"Reaction","diagram":false,"children":[${complex}]}]}`
    );
  });

  it('writes an object with nothing below it alone, a non-event without diagram', async () => {
    rows = [
      {
        db: [
          'R-HSA-3',
          'e entity',
          null,
          HUMAN,
          'Complex',
          ['DatabaseObject', 'PhysicalEntity', 'Complex'],
          0,
        ],
        steps: null,
      },
    ];
    expect(await (await get('R-HSA-3/getSubGraph')).text()).toBe(
      '{"stId":"R-HSA-3","name":"e entity","species":"Homo sapiens","type":"Complex"}'
    );
  });

  it('keeps every item, as getSubHierarchy parses with omitNonDisplayableItems false', async () => {
    // Not reached along these relationships today; parseRaw is told to keep it.
    rows = [{ db: PATHWAY, steps: [['R-HSA-6', 'r', null, HUMAN, 'Requirement', null, 0]] }];
    expect(await (await get('R-HSA-1/getSubGraph')).text()).toBe(
      '{"stId":"R-HSA-1","name":"Pathway A","species":"Homo sapiens","type":"Pathway","diagram":true,"children":[' +
        '{"stId":"R-HSA-6","name":"r","species":"Homo sapiens","type":"Requirement","diagram":false}]}'
    );
  });

  it("answers no object with Java's 404", async () => {
    expect(await messages(await get('R-HSA-9/getSubGraph'))).toEqual([
      404,
      ['No sub graph found for given id: R-HSA-9'],
    ]);
    expect(await messages(await get('foo/getSubGraph'))).toEqual([
      404,
      ['No sub graph found for given id: foo'],
    ]);
  });

  it("answers dots, and a dbId past a long, with Java's 500 before any query", async () => {
    expect(await messages(await get('.../getSubGraph'))).toEqual([
      500,
      ['Index 0 out of bounds for length 0'],
    ]);
    expect(await messages(await get('99999999999999999999.2/getSubGraph'))).toEqual([
      500,
      ['For input string: "99999999999999999999"'],
    ]);
    expect(asked).toEqual([]);
  });

  it('reads no parameter', async () => {
    rows = [{ db: PATHWAY, steps: null }];
    expect((await get('R-HSA-1/getSubGraph?directParticipants=bad')).status).toBe(200);
  });
});

describe('/detail/{id}/getReverseGraph', () => {
  const PTEN: Step = [
    'R-HSA-10',
    'PTEN',
    null,
    HUMAN,
    'EntityWithAccessionedSequence',
    ['DatabaseObject', 'PhysicalEntity', 'EntityWithAccessionedSequence'],
    0,
  ];
  const CATALYSIS: Step = [null, 'activity', null, null, 'CatalystActivity', null, 0];
  const R: Step = ['R-HSA-11', 'r', false, HUMAN, 'Reaction', null, 0];
  const R2: Step = ['R-HSA-12', 'r2', false, HUMAN, 'Reaction', null, 0];
  const P: Step = ['R-HSA-13', 'p', true, HUMAN, 'Pathway', null, 0];
  const PATHS: Step[][] = [[CATALYSIS], [CATALYSIS, R], [R2], [R2, P]];
  const r =
    '{"stId":"R-HSA-11","name":"r","species":"Homo sapiens","type":"Reaction","diagram":false}';
  const r2 =
    '{"stId":"R-HSA-12","name":"r2","species":"Homo sapiens","type":"Reaction","diagram":false,"children":[' +
    '{"stId":"R-HSA-13","name":"p","species":"Homo sapiens","type":"Pathway","diagram":true}]}';
  const root =
    '{"stId":"R-HSA-10","name":"PTEN","species":"Homo sapiens","type":"EntityWithAccessionedSequence"';

  it("asks locationsInPWB's query, all relationships unless directParticipants", async () => {
    rows = [{ db: PTEN, steps: null }];
    await get('R-HSA-10/getReverseGraph');
    expect(query()[0]).toContain('|activeUnit|');
    await get('R-HSA-10/getReverseGraph?directParticipants=true');
    expect(query()[0]).not.toContain('|activeUnit|');
    expect(query()[0]).toMatch(
      /^MATCH \(n:DatabaseObject\{stId:\$stId\}\) OPTIONAL MATCH path=\(n\)<-\[/
    );
  });

  it('leaves out what the browser cannot place, by default', async () => {
    rows = PATHS.map((steps) => ({ db: PTEN, steps }));
    expect(await (await get('R-HSA-10/getReverseGraph')).text()).toBe(
      `${root},"children":[${r},${r2}]}`
    );
    expect(await (await get('R-HSA-10/getReverseGraph?omitNonDisplayableItems=true')).text()).toBe(
      `${root},"children":[${r},${r2}]}`
    );
  });

  it('keeps it with omitNonDisplayableItems=false', async () => {
    rows = PATHS.map((steps) => ({ db: PTEN, steps }));
    expect(await (await get('R-HSA-10/getReverseGraph?omitNonDisplayableItems=false')).text()).toBe(
      `${root},"children":[{"name":"activity","type":"CatalystActivity","diagram":false,"children":[${r}]},${r2}]}`
    );
  });

  it("answers a cycle -- the nodes without a stable id made one -- with the StackOverflowError's 500", async () => {
    // [R, CATALYSIS] puts the one stId-less node below R, which is below it.
    rows = [[CATALYSIS], [CATALYSIS, R], [R], [R, CATALYSIS]].map((steps) => ({ db: PTEN, steps }));
    expect(
      await messages(await get('R-HSA-10/getReverseGraph?omitNonDisplayableItems=false'))
    ).toEqual([500, ['Handler dispatch failed; nested exception is java.lang.StackOverflowError']]);
    // Left out, the catalysis makes no cycle.
    expect((await get('R-HSA-10/getReverseGraph')).status).toBe(200);
  });

  it("refuses an unreadable boolean with Java's 400, directParticipants first, before the id", async () => {
    const [status, [message]] = await messages(
      await get('foo/getReverseGraph?omitNonDisplayableItems=bad&directParticipants=worse')
    );
    expect(status).toBe(400);
    expect(message).toMatch(/Invalid boolean value \[worse\]$/);
    expect(asked).toEqual([]);
  });

  it("answers no object with Java's 404, as locationsInPWB does", async () => {
    expect(await messages(await get('R-HSA-9/getReverseGraph'))).toEqual([
      404,
      ['Reverse sub graph found for id: R-HSA-9'],
    ]);
  });
});

describe('/detail/{id}/direction/...', () => {
  // AdvancedGeneralController's @RestController is commented out: no mapping.
  for (const path of [
    'R-HSA-1/direction/OUTGOING',
    'R-HSA-1/direction/INCOMING/displayName',
    'R-HSA-1/direction/UNDIRECTED/relationships/hasEvent,regulatedBy',
    'R-HSA-1/direction/OUTGOING/relationships/hasEvent/displayName',
  ])
    it(`is Spring's own 404: ${path}`, async () => {
      const response = await get(path);
      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['timestamp', 'status', 'error', 'path']);
      expect(body).toMatchObject({
        status: 404,
        error: 'Not Found',
        path: `/ContentService/data/detail/${path}`,
      });
      expect(asked).toEqual([]);
    });
});
