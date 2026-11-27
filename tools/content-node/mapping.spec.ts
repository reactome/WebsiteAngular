// @vitest-environment node
//
// /data/mapping/{resource}/{identifier}/pathways and .../reactions -- the
// pathways and reactions an identifier in an outside resource takes part in
// -- with a stand-in graph. MappingController over graph-core's
// MappingService and MappingRepository, whose queries are kept as written.
// The events here are invented; Java's answers were measured 17 Oct 2026,
// and in the views and identities on 27 Nov 2026 (#953).
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** A query's parameters; the species' taxId is the one these read by name. */
type Params = { taxId?: string; value?: string; [name: string]: unknown };
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
let rows: unknown[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params, options?: { graph?: boolean }) => {
    asked.push([cypher, params]);
    // speciesTaxId's lookups: 9606 and Homo sapiens are a species, nothing else.
    if (/^MATCH \(s:Species/.test(cypher))
      return params.value === '9606' || params.value === 'Homo sapiens' ? [{ taxId: '9606' }] : [];
    // As the driver: without `graph`, a node is its properties alone, so a
    // route that forgets `graph` reads what Neo4j would give it.
    return options?.graph
      ? rows
      : rows.map((row) =>
          Object.fromEntries(
            Object.entries(row as Record<string, GraphNode>).map(([k, v]) => [k, v.props])
          )
        );
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

const get = (path: string) => fetch(`${base}/ContentService/data/mapping/${path}`);
const mapped = () => asked.filter(([cypher]) => !/^MATCH \(s:Species/.test(cypher));
/** The last query asked but the species lookups; none at all is a failure. */
const last = () => {
  const query = mapped().at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  return query;
};
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];

/** A node of these classes, the most specific last, as the driver gives it in graph mode. */
const node = (props: Record<string, unknown>, ...labels: string[]): GraphNode => ({
  id: Number(props['dbId']),
  labels: ['DatabaseObject', ...labels],
  props: { ...props, schemaClass: labels.at(-1) ?? 'DatabaseObject' },
});
const pathway = (props: Record<string, unknown>) => node(props, 'Event', 'Pathway');
const reaction = (props: Record<string, unknown>) =>
  node(props, 'Event', 'ReactionLikeEvent', 'Reaction');

const MAPPED =
  'MATCH (n)-[:referenceDatabase]->(rd:ReferenceDatabase) WHERE toLower(rd.displayName) = toLower($databaseName) AND (n.identifier = $identifier OR n.variantIdentifier = $identifier OR $identifier IN n.geneName OR $identifier IN n.name) WITH DISTINCT n MATCH (pe:PhysicalEntity)-[:referenceEntity|referenceSequence|crossReference|referenceGene*]->(n) WITH DISTINCT pe ';
const UNDER =
  '[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe)';

describe('/data/mapping/{resource}/{identifier}/reactions', () => {
  it("runs graph-core's query as written, the resource and identifier as given", async () => {
    rows = [{ rle: reaction({ dbId: 2, stId: 'R-HSA-2' }) }];
    asked.length = 0;
    const response = await get('UniProt/P04637/reactions');
    const reactions = (await response.json()) as { dbId: number; className: string }[];
    expect(reactions.map((r) => [r.dbId, r.className])).toEqual([[2, 'Reaction']]);
    expect(last()[0]).toBe(
      `${MAPPED}MATCH (rle:ReactionLikeEvent)-${UNDER} RETURN DISTINCT rle ORDER BY rle.stId`
    );
    expect(last()[1]).toEqual({ databaseName: 'UniProt', identifier: 'P04637' });
  });

  it('filters by a species it finds, by its taxId', async () => {
    rows = [{ rle: reaction({ dbId: 2 }) }];
    asked.length = 0;
    await get('UniProt/P04637/reactions?species=Homo_sapiens');
    expect(last()[0]).toBe(
      `${MAPPED}MATCH (:Species{taxId:$taxId})<-[:species]-(rle:ReactionLikeEvent)-${UNDER} RETURN DISTINCT rle ORDER BY rle.stId`
    );
    expect(last()[1].taxId).toBe('9606');
  });

  it('is a 404 for a species it does not find, without asking for the reactions', async () => {
    asked.length = 0;
    expect(await messages(await get('UniProt/P04637/reactions?species=nonsense'))).toEqual([
      404,
      ['No reactions found for UniProt:P04637'],
    ]);
    expect(mapped()).toEqual([]);
  });

  it('takes a chemical in human when no species is given, and none when one is empty', async () => {
    rows = [{ rle: reaction({ dbId: 2 }) }];
    for (const resource of ['ChEBI', 'PubChem Compound', 'pubchem']) {
      asked.length = 0;
      await get(`${encodeURIComponent(resource)}/15422/reactions`);
      expect([resource, last()[1].taxId]).toEqual([resource, '9606']);
    }
    asked.length = 0;
    await get('ChEBI/15422/reactions?species=');
    expect(last()[1].taxId).toBe(undefined);
  });
});

describe('/data/mapping/{resource}/{identifier}/pathways', () => {
  it("runs graph-core's query as written", async () => {
    rows = [{ p: pathway({ dbId: 3, stId: 'R-HSA-3' }) }];
    asked.length = 0;
    const response = await get('uniprot/P04637/pathways?species=9606');
    expect(((await response.json()) as { dbId: number }[]).map((p) => p.dbId)).toEqual([3]);
    expect(last()[0]).toBe(
      `${MAPPED}MATCH (rle:ReactionLikeEvent)-${UNDER} WITH DISTINCT rle MATCH (:Species{taxId:$taxId})<-[:species]-(p:Pathway)-[:hasEvent]->(rle) RETURN DISTINCT p ORDER BY p.stId`
    );
  });

  it("reads a GO identifier's digits, and asks GO's own question", async () => {
    rows = [{ p: pathway({ dbId: 3 }) }];
    asked.length = 0;
    await get('go/GO:0006915/pathways');
    expect(last()[0]).toBe(
      'MATCH (p:Pathway)-[:goBiologicalProcess*]->(go:GO_BiologicalProcess) WHERE go.accession = $identifier RETURN DISTINCT p ORDER BY p.stId'
    );
    expect(last()[1]).toEqual({ identifier: '0006915' });
    asked.length = 0;
    await get('GO/0006915/pathways?species=9606');
    expect(last()[0]).toBe(
      'MATCH (p:Pathway)-[:goBiologicalProcess*]->(go:GO_BiologicalProcess) WHERE go.accession = $identifier WITH DISTINCT p MATCH (p)-[:species]->(:Species{taxId: $taxId}) RETURN p ORDER BY p.stId'
    );
    expect(last()[1]).toEqual({ identifier: '0006915', taxId: '9606' });
    // Only an identifier starting "go" is cut to its digits.
    asked.length = 0;
    await get('GO/0006915x/pathways');
    expect(last()[1]).toEqual({ identifier: '0006915x' });
  });

  it('is a 404 naming the resource and identifier as given', async () => {
    rows = [];
    expect(await messages(await get('GO/GO:0006915/reactions'))).toEqual([
      404,
      ['No reactions found for GO:GO:0006915'],
    ]);
    // Not GO's question: only /pathways asks it.
    expect(last()[0]).toMatch(/RETURN DISTINCT rle ORDER BY rle\.stId$/);
    expect(last()[1]).toEqual({ databaseName: 'GO', identifier: 'GO:0006915' });
    asked.length = 0;
    // A GO identifier with no digits is nothing to look for.
    expect(await messages(await get('GO/GO:/pathways'))).toEqual([
      404,
      ['No pathways found for GO:GO:'],
    ]);
    expect(mapped()).toEqual([]);
  });

  it('looks the species up first, as MappingService does, even for a GO identifier with no digits', async () => {
    asked.length = 0;
    await get('GO/GO:/pathways?species=9606');
    expect(asked.map(([cypher]) => /^MATCH \(s:Species/.test(cypher))).toEqual([true]);
  });
});

describe("the reactions and pathways, as Java's domain serialiser writes them (#953)", () => {
  it("writes a reaction of any class with an event's fields, then the reaction's, className 'Reaction' before schemaClass", async () => {
    rows = [
      {
        rle: node(
          {
            dbId: 1,
            displayName: 'r',
            stId: 'R-HSA-1',
            stIdVersion: 'R-HSA-1.1',
            definition: 'd',
            oldStId: 'REACT_1',
            isInDisease: false,
            isInferred: false,
            maxDepth: 1,
            name: ['r'],
            releaseDate: '2020-01-01',
            releaseStatus: 'UPDATED',
            speciesName: 'Homo sapiens',
            isChimeric: false,
            systematicName: 's',
            category: 'transition',
          },
          'Event',
          'ReactionLikeEvent',
          'BlackBoxEvent'
        ),
      },
    ];
    const body = (await (await get('UniProt/P04637/reactions')).json()) as Record<
      string,
      unknown
    >[];
    expect(Object.keys(body[0] ?? {})).toEqual([
      'dbId',
      'displayName',
      'stId',
      'stIdVersion',
      'definition',
      'isInDisease',
      'isInferred',
      'maxDepth',
      'name',
      'releaseDate',
      'releaseStatus',
      'speciesName',
      'isChimeric',
      'systematicName',
      'category',
      'className',
      'schemaClass',
    ]);
    expect([body[0]?.['className'], body[0]?.['schemaClass']]).toEqual([
      'Reaction',
      'BlackBoxEvent',
    ]);
  });

  // Java's answer for R-HSA-162582 under /data/pathways/low/entity, 14 Oct 2026.
  const SIGNALLING = {
    dbId: 162582,
    oldStId: 'REACT_111102',
    displayName: 'Signal Transduction',
    stId: 'R-HSA-162582',
    stIdVersion: 'R-HSA-162582.13',
    isInDisease: false,
    isInferred: false,
    maxDepth: 13,
    name: ['Signal Transduction', 'Signaling Pathways'],
    releaseDate: '2011-09-20',
    releaseStatus: 'UPDATED',
    speciesName: 'Homo sapiens',
    hasDiagram: true,
    hasEHLD: true,
    diagramWidth: 631,
    diagramHeight: 589,
    lastUpdatedDate: '2023-06-07',
  };
  const topLevel = (props: Record<string, unknown>) =>
    node(props, 'Event', 'Pathway', 'TopLevelPathway');

  it("writes a pathway's keys in Java's order, and not the ones it leaves out", async () => {
    rows = [{ p: topLevel(SIGNALLING) }];
    expect(await (await get('uniprot/P04637/pathways')).text()).toBe(
      '[{"dbId":162582,"displayName":"Signal Transduction","stId":"R-HSA-162582",' +
        '"stIdVersion":"R-HSA-162582.13","isInDisease":false,"isInferred":false,"maxDepth":13,' +
        '"name":["Signal Transduction","Signaling Pathways"],"releaseDate":"2011-09-20",' +
        '"releaseStatus":"UPDATED","speciesName":"Homo sapiens","hasDiagram":true,"hasEHLD":true,' +
        '"lastUpdatedDate":"2023-06-07","schemaClass":"TopLevelPathway","className":"TopLevelPathway"}]'
    );
  });

  it('puts a definition after stIdVersion and a doi after speciesName, and defaults hasEHLD to false', async () => {
    const { hasEHLD: _withoutEhld, ...withoutEhld } = SIGNALLING;
    rows = [{ p: topLevel({ ...withoutEhld, definition: 'd', doi: '10.3180/x' }) }];
    const body = (await (await get('go/GO:0006915/pathways')).json()) as Record<string, unknown>[];
    const keys = Object.keys(body[0] ?? {});
    expect(keys.slice(3, 5)).toEqual(['stIdVersion', 'definition']);
    expect(keys.slice(keys.indexOf('speciesName'), keys.indexOf('speciesName') + 2)).toEqual([
      'speciesName',
      'doi',
    ]);
    expect(body[0]?.['hasEHLD']).toBe(false);
  });

  for (const [path, column, make] of [
    ['UniProt/P04637/reactions', 'rle', reaction],
    ['UniProt/P04637/pathways', 'p', pathway],
    ['GO/GO:0006915/pathways', 'p', pathway],
  ] as const) {
    it(`${path} gives JSOG ids with includeRef=true, in any case`, async () => {
      rows = [{ [column]: make({ dbId: 2 }) }, { [column]: make({ dbId: 1 }) }];
      for (const value of ['true', 'TRUE']) {
        const text = await (await get(`${path}?includeRef=${value}`)).text();
        expect([value, text.match(/"@id":"\d+","dbId":\d+/g)]).toEqual([
          value,
          ['"@id":"1","dbId":2', '"@id":"2","dbId":1'],
        ]);
      }
    });

    it(`${path} gives none without it, nor for another value (Boolean.parseBoolean)`, async () => {
      rows = [{ [column]: make({ dbId: 2 }) }];
      for (const query of ['', '?includeRef=false', '?includeRef=yes', '?includeRef=1']) {
        const text = await (await get(`${path}${query}`)).text();
        expect([query, text.startsWith('[{"dbId":2,')]).toEqual([query, true]);
      }
    });
  }
});
