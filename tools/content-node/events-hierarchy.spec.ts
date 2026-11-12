// @vitest-environment node
//
// /data/eventsHierarchy/{species}?pathwaysOnly=true (spec 006 T103b) through
// the service, with a stand-in graph and stand-in sizes. The live answers are
// compared with Java's for every species by hand (T103b in tasks.md): this
// holds the rules -- the species as SpeciesService finds it, the tree as
// HierarchyBuilder and a TreeSet make it, Java's errors -- in place.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Species = { dbId: number; taxId: string | null; displayName: string; names: string[] };
const SPECIES: Species[] = [
  {
    dbId: 500,
    taxId: '1111',
    displayName: 'Testus specius',
    names: ['Testus specius', 'T. specius'],
  },
  // A species with no top-level pathway: no hierarchy.
  { dbId: 501, taxId: '2222', displayName: 'Otherus', names: ['Otherus'] },
];

/** Top-level pathways, as the query orders them (by toLower(displayName)). */
const TOPS = ['R-TST-1', 'R-TST-2'];
/** hasEvent between pathways, with their order. */
const EDGES = [
  { parent: 'R-TST-1', child: 'R-TST-12', order: 2 },
  { parent: 'R-TST-1', child: 'R-TST-11', order: 1 },
  // Same order and name as R-TST-11 under the same parent: a TreeSet keeps one.
  { parent: 'R-TST-1', child: 'R-TST-13', order: 1 },
  // 'Beta' before 'alpha' at the same order: String.compareTo puts capitals first.
  { parent: 'R-TST-2', child: 'R-TST-21', order: 0 },
  { parent: 'R-TST-2', child: 'R-TST-22', order: 0 },
  // R-TST-4 sits under two parents, the same subtree under each.
  { parent: 'R-TST-11', child: 'R-TST-4', order: 0 },
  { parent: 'R-TST-21', child: 'R-TST-4', order: 3 },
];
const PATHWAYS: Record<string, { name: string; type: string; diagram: boolean | null }> = {
  'R-TST-1': { name: 'A top', type: 'TopLevelPathway', diagram: true },
  'R-TST-2': { name: 'b top', type: 'TopLevelPathway', diagram: false },
  'R-TST-11': { name: 'Twin', type: 'Pathway', diagram: false },
  'R-TST-12': { name: 'Later', type: 'CellLineagePath', diagram: null },
  'R-TST-13': { name: 'Twin', type: 'Pathway', diagram: true },
  'R-TST-21': { name: 'alpha', type: 'Pathway', diagram: false },
  'R-TST-22': { name: 'Beta', type: 'Pathway', diagram: false },
  'R-TST-4': { name: 'Leaf', type: 'Pathway', diagram: true },
};

const pick = (s: Species) => ({ dbId: s.dbId, taxId: s.taxId, displayName: s.displayName });

vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Record<string, unknown>) => {
    if (cypher.includes('$name IN s.name'))
      return SPECIES.filter((s) => s.names.includes(params['name'] as string)).map(pick);
    if (cypher.includes('MATCH (s:Species {taxId: $taxId}) RETURN'))
      return SPECIES.filter((s) => s.taxId === params['taxId']).map(pick);
    if (cypher.includes('MATCH (s:Species {dbId: $dbId})'))
      return SPECIES.filter((s) => s.dbId === Number(params['dbId'])).map(pick);
    if (cypher.includes('count(t) AS n')) return [{ n: params['taxId'] === '1111' ? 2 : 0 }];
    if (cypher.includes('RETURN t.stId AS stId'))
      return params['taxId'] === '1111' ? TOPS.map((stId) => ({ stId })) : [];
    if (cypher.includes('r.order AS order')) return params['taxId'] === '1111' ? EDGES : [];
    if (cypher.includes('p.hasDiagram AS diagram'))
      return (params['stIds'] as string[]).map((stId) => ({ stId, ...PATHWAYS[stId] }));
    return [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

vi.mock('./analysis-sizes.ts', () => ({
  analysisSizes: async () =>
    new Map(
      Object.keys(PATHWAYS).map((stId, i) => [
        stId,
        { totalEntity: i + 1, totalEntityAndInteractors: 10 * (i + 1) },
      ])
    ),
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

const get = (path: string) => fetch(`${base}/ContentService/data/eventsHierarchy/${path}`);
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];

const leaf = (sizes: string) =>
  `{"stId":"R-TST-4","name":"Leaf","species":"Testus specius","type":"Pathway","diagram":true,${sizes}}`;
const LEAF = leaf('"totalEntity":8,"totalEntityAndInteractors":80');
/** The tree, as Java writes it: Jackson's order, children left out on a leaf. */
const TREE =
  '[{"stId":"R-TST-1","name":"A top","species":"Testus specius","type":"TopLevelPathway","diagram":true,"totalEntity":1,"totalEntityAndInteractors":10,"children":[' +
  `{"stId":"R-TST-11","name":"Twin","species":"Testus specius","type":"Pathway","diagram":false,"totalEntity":3,"totalEntityAndInteractors":30,"children":[${LEAF}]},` +
  '{"stId":"R-TST-12","name":"Later","species":"Testus specius","type":"CellLineagePath","diagram":false,"totalEntity":4,"totalEntityAndInteractors":40}]},' +
  '{"stId":"R-TST-2","name":"b top","species":"Testus specius","type":"TopLevelPathway","diagram":false,"totalEntity":2,"totalEntityAndInteractors":20,"children":[' +
  '{"stId":"R-TST-22","name":"Beta","species":"Testus specius","type":"Pathway","diagram":false,"totalEntity":7,"totalEntityAndInteractors":70},' +
  `{"stId":"R-TST-21","name":"alpha","species":"Testus specius","type":"Pathway","diagram":false,"totalEntity":6,"totalEntityAndInteractors":60,"children":[${LEAF}]}]}]`;

describe('/data/eventsHierarchy/{species}?pathwaysOnly=true', () => {
  it('is the species hierarchy, ordered and merged as Java orders and merges it', async () => {
    const response = await get('1111?pathwaysOnly=true');
    expect([response.status, await response.text()]).toEqual([200, TREE]);
    expect(response.headers.get('content-disposition')).toBe(
      'inline; swaggerDownload="attachment"; filename="1111.json"'
    );
  });

  it('finds the species by taxId, dbId, or any name as SpeciesService reads it', async () => {
    for (const species of ['500', 'testus_specius', 'TESTUS%20%20specius', 'T.%20specius']) {
      const response = await get(`${species}?pathwaysOnly=true`);
      expect([species, response.status, await response.text()]).toEqual([species, 200, TREE]);
      // The header names the species as given, decoded.
      expect(response.headers.get('content-disposition')).toBe(
        `inline; swaggerDownload="attachment"; filename="${decodeURIComponent(species)}.json"`
      );
    }
  });

  it("is Java's generic 500 for no species, or one without a hierarchy", async () => {
    for (const species of ['foo', 'Testusspecius', 'testus specius ', '%201111', '2222', '9'])
      expect([species, ...(await messages(await get(`${species}?pathwaysOnly=true`)))]).toEqual([
        species,
        500,
        ['Something unexpected happened and the error has been reported.'],
      ]);
  });

  it("is Long.valueOf's failure for a number past a long", async () => {
    expect(await messages(await get('99999999999999999999?pathwaysOnly=true'))).toEqual([
      500,
      ['For input string: "99999999999999999999"'],
    ]);
  });

  it("reads its Booleans as Spring binds them, in the controller's order", async () => {
    const refused = (value: string) =>
      "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; " +
      `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${value}]`;
    expect(await messages(await get('foo?pathwaysOnly=maybe&interactors=no2'))).toEqual([
      400,
      [refused('maybe')],
    ]);
    expect(
      await messages(await get('1111?pathwaysOnly=true&interactors=no2&importableOnly=x'))
    ).toEqual([400, [refused('no2')]]);
    expect(await messages(await get('1111?pathwaysOnly=true&importableOnly=x'))).toEqual([
      400,
      [refused('x')],
    ]);
    for (const value of ['TRUE', 'yes', 'on', '1', '%20true%20'])
      expect((await get(`1111?pathwaysOnly=${value}`)).status).toBe(200);
  });

  it('leaves the full tree and the analysis overlay for later (T103c, T103d)', async () => {
    for (const path of ['1111', '1111?pathwaysOnly=false', '1111?pathwaysOnly=true&token=abc'])
      expect((await get(path)).status).toBe(501);
  });
});
