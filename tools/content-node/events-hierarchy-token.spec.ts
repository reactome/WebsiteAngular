// @vitest-environment node
//
// /data/eventsHierarchy/{species}?pathwaysOnly=true with an analysis token
// (spec 006 T103c, research D25), through the service, with a stand-in graph,
// stand-in static figures and a stand-in AnalysisService. The live answers are
// compared with Java's by hand (tasks.md, T103c); this holds the rules: the
// overlay from the top down, the figures in Java's order and form, those the
// AnalysisService leaves out made from the static ones, and the token's errors.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SPECIES = { dbId: 500, taxId: '1111', displayName: 'Testus' };
/** TOP holds A, which holds B; OTHER holds C. */
const PATHWAYS: Record<string, { name: string; type: string }> = {
  'R-TST-1': { name: 'TOP', type: 'TopLevelPathway' },
  'R-TST-2': { name: 'OTHER', type: 'TopLevelPathway' },
  'R-TST-11': { name: 'A', type: 'Pathway' },
  'R-TST-111': { name: 'B', type: 'Pathway' },
  'R-TST-21': { name: 'C', type: 'Pathway' },
};
const EVENTS = [
  { parent: 'R-TST-1', child: 'R-TST-11', order: 0, pathway: true },
  { parent: 'R-TST-11', child: 'R-TST-111', order: 0, pathway: true },
  { parent: 'R-TST-2', child: 'R-TST-21', order: 0, pathway: true },
];

vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Record<string, unknown>) => {
    if (cypher.includes('MATCH (s:Species {taxId: $taxId}) RETURN'))
      return params['taxId'] === '1111' ? [SPECIES] : [];
    if (cypher.includes('count(t) AS n')) return [{ n: 2 }];
    if (cypher.includes('RETURN n.stId AS stId')) return [{ stId: 'R-TST-1' }, { stId: 'R-TST-2' }];
    if (cypher.includes('r.order AS order')) return EVENTS;
    if (cypher.includes('p.hasDiagram AS diagram'))
      return (params['stIds'] as string[]).map((stId) => ({
        stId,
        ...PATHWAYS[stId],
        diagram: false,
      }));
    return [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const counts = (n: number) => ({
  entities: n,
  interactors: 2 * n,
  entitiesAndInteractors: 3 * n,
  reactions: n + 1,
});
/** Every pathway's static figures: UNIPROT and CHEBI, the main ones; EMBL, an auxiliary one. */
const figure = (n: number) => ({
  resources: new Map([
    ['UNIPROT', counts(n)],
    ['CHEBI', counts(1)],
  ]),
  combined: counts(n + 1),
  importable: counts(n),
});
vi.mock('./analysis-sizes.ts', () => ({
  analysisSizes: async () =>
    new Map(
      Object.keys(PATHWAYS).map((stId) => [stId, { totalEntity: 1, totalEntityAndInteractors: 2 }])
    ),
  analysisFigures: async () => ({
    pathways: new Map(Object.keys(PATHWAYS).map((stId, i) => [stId, figure(i + 2)])),
    species: {
      resources: new Map([
        ['UNIPROT', counts(100)],
        ['CHEBI', counts(50)],
      ]),
      combined: counts(200),
      importable: counts(150),
    },
  }),
}));

/** The AnalysisService's /token answers, by resource and importableOnly. */
let stored: { interactors: boolean; byQuery: Record<string, Record<string, unknown>[]> };
let status = 200;
const asked: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  status = 200;
  asked.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.includes('/AnalysisService/token/')) return realFetch(input, init);
    asked.push(url);
    const query = new URL(url).searchParams;
    const key = `${query.get('resource') ?? ''} ${query.get('importableOnly') ?? ''}`;
    if (status !== 200) return new Response('{}', { status });
    return Response.json({
      summary: { interactors: stored.interactors },
      pathways: stored.byQuery[key] ?? [],
    });
  });
});

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

const TOKEN = 'MjAyNjExMTIwMDAwMDBfMQ%3D%3D';
const get = (query: string) =>
  realFetch(`${base}/ContentService/data/eventsHierarchy/1111?pathwaysOnly=true&${query}`);
type Node = {
  stId: string;
  llp?: boolean;
  entities?: Record<string, unknown>;
  reactions?: Record<string, unknown>;
  children?: Node[];
};
const byStId = (nodes: Node[], out: Record<string, Node> = {}) => {
  for (const node of nodes) {
    out[node.stId] = node;
    byStId(node.children ?? [], out);
  }
  return out;
};

describe('the analysis overlay', () => {
  it('overlays from the top down, a node the result does not name left as it is, and all below it, named or not', async () => {
    stored = {
      interactors: false,
      byQuery: {
        'TOTAL false': [
          {
            stId: 'R-TST-1',
            llp: false,
            entities: {
              resource: 'TOTAL',
              total: 9,
              found: 2,
              ratio: 1,
              pValue: 1e-7,
              fdr: 0.02,
              exp: [],
            },
            reactions: { resource: 'TOTAL', total: 4, found: 1, ratio: 0.25 },
          },
          {
            stId: 'R-TST-111',
            llp: true,
            entities: {
              resource: 'TOTAL',
              total: 3,
              found: 1,
              ratio: 1,
              pValue: 1e-7,
              fdr: 0.5,
              exp: [],
            },
            reactions: { resource: 'TOTAL', total: 1, found: 1, ratio: 0.1 },
          },
          // C, under OTHER, which the result does not name: never reached.
          {
            stId: 'R-TST-21',
            llp: true,
            entities: { resource: 'TOTAL', total: 1, found: 1, ratio: 1 },
          },
        ],
      },
    };
    const response = await get(`token=${TOKEN}`);
    const text = await response.text();
    const nodes = byStId(JSON.parse(text) as Node[]);
    expect(Object.keys(nodes['R-TST-1'] ?? {})).toEqual([
      'stId',
      'name',
      'species',
      'type',
      'diagram',
      'llp',
      'totalEntity',
      'totalEntityAndInteractors',
      'entities',
      'reactions',
      'children',
    ]);
    // A, which the result does not name, has no figures -- and neither has B
    // below it, though the result names B: Java stops at A.
    expect(nodes['R-TST-11']?.llp).toBeUndefined();
    expect(nodes['R-TST-111']?.llp).toBeUndefined();
    expect(nodes['R-TST-21']?.llp).toBeUndefined();
    // In Java's order and form: a double as Java writes it, an empty exp left out.
    expect(text).toContain(
      '"entities":{"resource":"TOTAL","total":9,"found":2,"ratio":1.0,"pValue":1.0E-7,"fdr":0.02}'
    );
    expect(response.headers.get('content-disposition')).toBe(
      'inline; swaggerDownload="attachment"; filename="1111.json"'
    );
  });

  it("writes a chosen resource's figures where nothing was found, from the static ones", async () => {
    stored = {
      interactors: false,
      byQuery: {
        'TOTAL false': [
          {
            stId: 'R-TST-1',
            llp: false,
            entities: { resource: 'TOTAL', total: 9, found: 2, ratio: 0.5 },
          },
        ],
        // Nothing found for CHEBI: the AnalysisService lists no pathway.
        'CHEBI false': [],
      },
    };
    const nodes = byStId((await (await get(`token=${TOKEN}&resource=CHEBI`)).json()) as Node[]);
    expect([nodes['R-TST-1']?.entities, nodes['R-TST-1']?.reactions]).toEqual([
      { resource: 'CHEBI', total: 1, found: 0, ratio: 0.02 },
      { resource: 'CHEBI', total: 2, found: 0, ratio: 2 / 51 },
    ]);
    // A name Java does not know, or knows in another case: the llp alone.
    for (const resource of ['chebi', 'NOPE']) {
      const node = byStId(
        (await (await get(`token=${TOKEN}&resource=${resource}`)).json()) as Node[]
      )['R-TST-1'];
      expect([resource, node?.llp, node?.entities]).toEqual([resource, false, undefined]);
    }
  });

  it('writes a pathway found only through auxiliary resources, asked importableOnly, as found nothing importable', async () => {
    stored = {
      interactors: false,
      byQuery: {
        'TOTAL false': [
          {
            stId: 'R-TST-1',
            llp: true,
            entities: { resource: 'TOTAL', total: 9, found: 2, ratio: 0.5 },
          },
        ],
        'TOTAL true': [],
      },
    };
    const node = byStId((await (await get(`token=${TOKEN}&importableOnly=true`)).json()) as Node[])[
      'R-TST-1'
    ];
    expect([node?.llp, node?.entities, node?.reactions]).toEqual([
      true,
      { resource: 'TOTAL', total: 2, found: 0, ratio: 0.01 },
      { resource: 'TOTAL', total: 3, found: 0, ratio: 3 / 201 },
    ]);
  });

  it('builds interactor figures for an analysis run without them from the static ones and its found', async () => {
    stored = {
      interactors: false,
      byQuery: {
        'TOTAL false': [
          {
            stId: 'R-TST-1',
            llp: false,
            entities: {
              resource: 'TOTAL',
              total: 3,
              found: 2,
              ratio: 0.015,
              pValue: 0.1,
              fdr: 0.2,
            },
            reactions: { resource: 'TOTAL', total: 3, found: 1, ratio: 0.1 },
          },
        ],
      },
    };
    const node = byStId((await (await get(`token=${TOKEN}&interactors=true`)).json()) as Node[])[
      'R-TST-1'
    ];
    expect(node?.entities).toEqual({
      resource: 'TOTAL',
      total: 9,
      found: 2,
      ratio: 9 / 600,
      curatedTotal: 3,
      curatedFound: 2,
      interactorsTotal: 6,
      interactorsFound: 0,
      pValue: 0.1,
      fdr: 0.2,
    });
  });
});

describe('the token', () => {
  const messages = async (response: Response) => [
    response.status,
    ((await response.json()) as { messages: string[] }).messages,
    response.headers.get('content-disposition'),
  ];
  const HEADER = 'inline; swaggerDownload="attachment"; filename="1111.json"';

  it("is Java's 500 with its decoders' messages, the header already set", async () => {
    expect(await messages(await get('token=%20'))).toEqual([
      500,
      ['Input byte[] should at least have 2 bytes for base64 bytes'],
      HEADER,
    ]);
    expect(await messages(await get('token=%25'))).toEqual([
      500,
      ['URLDecoder: Incomplete trailing escape (%) pattern'],
      HEADER,
    ]);
    expect(await messages(await get('token=MjAyNjExMTEwMDAwMDBfOTk5%3D%3D'))).toEqual([
      500,
      ['Input byte array has wrong 4-byte ending unit'],
      HEADER,
    ]);
    expect(asked).toEqual([]);
  });

  it('is "Not Found" or "Gone" as the AnalysisService says', async () => {
    stored = { interactors: false, byQuery: {} };
    status = 404;
    expect(await messages(await get(`token=${TOKEN}`))).toEqual([500, ['Not Found'], HEADER]);
    status = 410;
    expect(await messages(await get(`token=${TOKEN}`))).toEqual([500, ['Gone'], HEADER]);
    // Decoded until it no longer changes -- an encoded token encoded again
    // -- then asked by its decoded form.
    status = 404;
    expect(await messages(await get('token=MjAyNjExMTIwMDAwMDBfMQ%25253D%25253D'))).toEqual([
      500,
      ['Not Found'],
      HEADER,
    ]);
    expect(asked.at(-1)).toContain('/AnalysisService/token/MjAyNjExMTIwMDAwMDBfMQ%3D%3D?');
  });
});
