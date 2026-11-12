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
  // Top-level pathways, no taxId: an empty hierarchy.
  { dbId: 502, taxId: null, displayName: 'Nullus', names: ['Nullus'] },
  // An empty taxId: the graph would find its top-level pathways; Java's
  // HierarchyBuilder leaves its hierarchy empty all the same.
  { dbId: 505, taxId: '', displayName: 'Emptius', names: ['Emptius'] },
  // Names Java finds through Character.toTitleCase: ǆ is ǅ, ß stays ß.
  { dbId: 503, taxId: '3333', displayName: 'ǅemo', names: ['ǅemo'] },
  { dbId: 504, taxId: '4444', displayName: 'ßpecies', names: ['ßpecies'] },
];
const WITH_TOP_LEVEL = new Set([500, 502, 503, 504, 505]);
const HAS_TREE = new Set(['1111', '']);

/** Top-level pathways, as the query orders them (by toLower(displayName)). */
const TOPS = ['R-TST-1', 'R-TST-2'];
/** Each pathway's events, with their hasEvent order, as the graph returns them. */
const EVENTS = [
  // A reaction first at order 2: the SortedSet keeps it, and R-TST-12 drops out.
  { parent: 'R-TST-1', child: 'R-HSA-R1', order: 2, pathway: false },
  { parent: 'R-TST-1', child: 'R-TST-12', order: 2, pathway: true },
  { parent: 'R-TST-1', child: 'R-TST-11', order: 1, pathway: true },
  // The same order as R-TST-11 under the same parent: one of the two is kept.
  { parent: 'R-TST-1', child: 'R-TST-13', order: 1, pathway: true },
  { parent: 'R-TST-1', child: 'R-TST-14', order: 3, pathway: true },
  // By order, whatever the names: Beta (order 0) before alpha (order 1).
  { parent: 'R-TST-2', child: 'R-TST-21', order: 1, pathway: true },
  { parent: 'R-TST-2', child: 'R-TST-22', order: 0, pathway: true },
  // R-TST-4 sits under two parents, the same subtree under each.
  { parent: 'R-TST-11', child: 'R-TST-4', order: 0, pathway: true },
  { parent: 'R-TST-21', child: 'R-TST-4', order: 3, pathway: true },
];
const PATHWAYS: Record<string, { name: string; type: string; diagram: boolean | null }> = {
  'R-TST-1': { name: 'A top', type: 'TopLevelPathway', diagram: true },
  'R-TST-2': { name: 'b top', type: 'TopLevelPathway', diagram: false },
  'R-TST-11': { name: 'Twin', type: 'Pathway', diagram: false },
  'R-TST-12': { name: 'Dropped', type: 'Pathway', diagram: false },
  'R-TST-13': { name: 'Other twin', type: 'Pathway', diagram: true },
  'R-TST-14': { name: 'Later', type: 'CellLineagePath', diagram: null },
  'R-TST-21': { name: 'alpha', type: 'Pathway', diagram: false },
  'R-TST-22': { name: 'Beta', type: 'Pathway', diagram: false },
  'R-TST-4': { name: 'Leaf', type: 'Pathway', diagram: true },
};

const pick = (s: Species) => ({ dbId: s.dbId, taxId: s.taxId, displayName: s.displayName });

/** A step of the event hierarchy's paths: stId, name, hasDiagram, species, class, labels, order. */
const step = (stId: string, name: string, type: string, order = 0) => [
  stId,
  name,
  type !== 'Reaction',
  'Testus specius',
  type,
  type === 'Reaction' ? ['Event', 'ReactionLikeEvent', 'Reaction'] : ['Event', 'Pathway', type],
  order,
];
const TOP = step('R-TST-1', 'A top', 'TopLevelPathway');
const SUB = step('R-TST-11', 'Twin', 'Pathway', 1);
const RXN = step('R-TST-R', 'A reaction', 'Reaction', 2);
/** The full form's rows: by taxId, a tree; by name, paths out of order -- a cycle. */
const FULL_ROWS = {
  taxId: [
    { db: TOP, nodePairCollection: [[SUB], [SUB, RXN]] },
    // The same top-level pathway again: one, as a TreeSet keeps it.
    { db: TOP, nodePairCollection: [[SUB]] },
  ],
  name: [{ db: TOP, nodePairCollection: [[SUB], [SUB, RXN], [SUB, RXN, SUB]] }],
};

/** How many times the full form's query was asked. */
let fullQueries = 0;

vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Record<string, unknown>) => {
    if (cypher.includes('nodePairCollection')) fullQueries++;
    if (cypher.includes('nodePairCollection'))
      return 'taxId' in params
        ? params['taxId'] === '1111'
          ? FULL_ROWS.taxId
          : []
        : params['speciesName'] === 'Testus specius'
          ? FULL_ROWS.name
          : [];
    if (cypher.includes('$name IN s.name'))
      return SPECIES.filter((s) => s.names.includes(params['name'] as string)).map(pick);
    if (cypher.includes('MATCH (s:Species {taxId: $taxId}) RETURN'))
      return SPECIES.filter((s) => s.taxId === params['taxId']).map(pick);
    if (cypher.includes('MATCH (s:Species {dbId: $dbId})'))
      return SPECIES.filter((s) => s.dbId === Number(params['dbId'])).map(pick);
    if (cypher.includes('count(t) AS n'))
      return [{ n: WITH_TOP_LEVEL.has(Number(params['dbId'])) ? 1 : 0 }];
    if (cypher.includes('RETURN n.stId AS stId'))
      return HAS_TREE.has(params['taxId'] as string) ? TOPS.map((stId) => ({ stId })) : [];
    if (cypher.includes('r.order AS order'))
      return HAS_TREE.has(params['taxId'] as string) ? EVENTS : [];
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

const sized = (stId: string) => {
  const i = Object.keys(PATHWAYS).indexOf(stId) + 1;
  return `"totalEntity":${i},"totalEntityAndInteractors":${10 * i}`;
};
const node = (stId: string, children?: string) => {
  const p = PATHWAYS[stId] as { name: string; type: string; diagram: boolean | null };
  return (
    `{"stId":"${stId}","name":"${p.name}","species":"Testus specius","type":"${p.type}",` +
    `"diagram":${p.diagram ?? false},${sized(stId)}${children ? `,"children":[${children}]` : ''}}`
  );
};
const LEAF = node('R-TST-4');
/**
 * The tree, as Java writes it: Jackson's order, children left out on a leaf;
 * R-TST-12 lost to a reaction at its order, R-TST-13 to R-TST-11 at theirs.
 */
const TREE = `[${node('R-TST-1', `${node('R-TST-11', LEAF)},${node('R-TST-14')}`)},${node(
  'R-TST-2',
  `${node('R-TST-22')},${node('R-TST-21', LEAF)}`
)}]`;

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

  it('is the 404 of an empty hierarchy, as Java finds it however the name is written', async () => {
    // No taxId: HierarchyBuilder leaves the hierarchy empty. ǆ title-cases to
    // ǅ, and ß stays ß, as Character.toTitleCase makes them.
    for (const species of ['Nullus', 'Emptius', '%C7%86emo', '%C3%9Fpecies'])
      expect([species, ...(await messages(await get(`${species}?pathwaysOnly=true`)))]).toEqual([
        species,
        404,
        [`No event hierarchy found for given species: ${decodeURIComponent(species)}`],
      ]);
  });

  it('writes the header as Tomcat does, past Latin-1 a ?', async () => {
    // 500 in Arabic-Indic digits: the species' dbId.
    const response = await get('%D9%A5%D9%A0%D9%A0?pathwaysOnly=true');
    expect([response.status, await response.text()]).toEqual([200, TREE]);
    expect(response.headers.get('content-disposition')).toBe(
      'inline; swaggerDownload="attachment"; filename="???.json"'
    );
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

  it('is the full tree without pathwaysOnly: every event, sized where it is a pathway', async () => {
    for (const path of ['1111', '1111?pathwaysOnly=false']) {
      const response = await get(path);
      expect([path, response.status, await response.text()]).toEqual([
        path,
        200,
        '[{"stId":"R-TST-1","name":"A top","species":"Testus specius","type":"TopLevelPathway","diagram":true,' +
          `${sized('R-TST-1')},"children":[{"stId":"R-TST-11","name":"Twin","species":"Testus specius","type":"Pathway","diagram":true,` +
          `${sized('R-TST-11')},"children":[{"stId":"R-TST-R","name":"A reaction","species":"Testus specius","type":"Reaction","diagram":false,` +
          '"totalEntity":0,"totalEntityAndInteractors":0}]}]}]',
      ]);
      expect(response.headers.get('content-disposition')).toBe(
        'inline; swaggerDownload="attachment"; filename="1111.json"'
      );
    }
  });

  it("asks by the name as given, and is Java's StackOverflowError when its paths make a cycle", async () => {
    const before = fullQueries;
    for (let ask = 0; ask < 2; ask++)
      expect(await messages(await get('Testus%20specius'))).toEqual([
        500,
        ['Handler dispatch failed; nested exception is java.lang.StackOverflowError'],
      ]);
    // Kept: the release's answer for that name, not worked out again.
    expect(fullQueries - before).toBe(1);
    // Found as pathwaysOnly finds it, but no top-level pathway has this
    // speciesName, or this taxId: no rows, Java's NullPointerException.
    for (const species of ['T.%20specius', '500'])
      expect(await messages(await get(species))).toEqual([
        500,
        ['Something unexpected happened and the error has been reported.'],
      ]);
  });
});
