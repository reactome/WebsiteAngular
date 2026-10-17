// @vitest-environment node
//
// /data/mapping/{resource}/{identifier}/pathways and .../reactions -- the
// pathways and reactions an identifier in an outside resource takes part in
// -- with a stand-in graph. MappingController over graph-core's
// MappingService and MappingRepository, whose queries are kept as written.
// The events here are invented; Java's answers were measured 17 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked = [];
let rows = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    // speciesTaxId's lookups: 9606 and Homo sapiens are a species, nothing else.
    if (/^MATCH \(s:Species/.test(cypher))
      return params.value === '9606' || params.value === 'Homo sapiens' ? [{ taxId: '9606' }] : [];
    return rows;
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app, reactionLikeEventJson } = await import('./service.mjs');

let base;
let server;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const get = (path) => fetch(`${base}/ContentService/data/mapping/${path}`);
const mapped = () => asked.filter(([cypher]) => !/^MATCH \(s:Species/.test(cypher));
const last = () => mapped()[mapped().length - 1];
const oneLine = (cypher) => cypher.replace(/\s+/g, ' ').trim();
const messages = async (response) => [response.status, (await response.json()).messages];

const MAPPED =
  'MATCH (n)-[:referenceDatabase]->(rd:ReferenceDatabase) WHERE toLower(rd.displayName) = toLower($databaseName) AND (n.identifier = $identifier OR n.variantIdentifier = $identifier OR $identifier IN n.geneName OR $identifier IN n.name) WITH DISTINCT n MATCH (pe:PhysicalEntity)-[:referenceEntity|referenceSequence|crossReference|referenceGene*]->(n) WITH DISTINCT pe ';
const UNDER =
  '[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe)';

describe('reactionLikeEventJson', () => {
  it("writes an event's fields, then the reaction's, className 'Reaction' before schemaClass", () => {
    const json = reactionLikeEventJson({
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
      schemaClass: 'BlackBoxEvent',
    });
    expect(Object.keys(json)).toEqual([
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
    expect(json.className).toBe('Reaction');
  });
});

describe('/data/mapping/{resource}/{identifier}/reactions', () => {
  it("runs graph-core's query as written, the resource and identifier as given", async () => {
    rows = [{ rle: { dbId: 2, stId: 'R-HSA-2', schemaClass: 'Reaction' } }];
    asked.length = 0;
    const response = await get('UniProt/P04637/reactions');
    expect((await response.json()).map((r) => [r.dbId, r.className])).toEqual([[2, 'Reaction']]);
    expect(oneLine(last()[0])).toBe(
      `${MAPPED}MATCH (rle:ReactionLikeEvent)-${UNDER} RETURN DISTINCT rle ORDER BY rle.stId`
    );
    expect(last()[1]).toEqual({ databaseName: 'UniProt', identifier: 'P04637' });
  });

  it('filters by a species it finds, by its taxId', async () => {
    rows = [{ rle: { dbId: 2, schemaClass: 'Reaction' } }];
    asked.length = 0;
    await get('UniProt/P04637/reactions?species=Homo_sapiens');
    expect(oneLine(last()[0])).toBe(
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
    rows = [{ rle: { dbId: 2, schemaClass: 'Reaction' } }];
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
    rows = [{ p: { dbId: 3, stId: 'R-HSA-3', schemaClass: 'Pathway' } }];
    asked.length = 0;
    const response = await get('uniprot/P04637/pathways?species=9606');
    expect((await response.json()).map((p) => p.dbId)).toEqual([3]);
    expect(oneLine(last()[0])).toBe(
      `${MAPPED}MATCH (rle:ReactionLikeEvent)-${UNDER} WITH DISTINCT rle MATCH (:Species{taxId:$taxId})<-[:species]-(p:Pathway)-[:hasEvent]->(rle) RETURN DISTINCT p ORDER BY p.stId`
    );
  });

  it("reads a GO identifier's digits, and asks GO's own question", async () => {
    rows = [{ p: { dbId: 3, schemaClass: 'Pathway' } }];
    asked.length = 0;
    await get('go/GO:0006915/pathways');
    expect(oneLine(last()[0])).toBe(
      'MATCH (p:Pathway)-[:goBiologicalProcess*]->(go:GO_BiologicalProcess) WHERE go.accession = $identifier RETURN DISTINCT p ORDER BY p.stId'
    );
    expect(last()[1]).toEqual({ identifier: '0006915' });
    asked.length = 0;
    await get('GO/0006915/pathways?species=9606');
    expect(oneLine(last()[0])).toBe(
      'MATCH (p:Pathway)-[:goBiologicalProcess*]->(go:GO_BiologicalProcess) WHERE go.accession = $identifier WITH DISTINCT p MATCH (p)-[:species]->(:Species{taxId: $taxId}) RETURN p ORDER BY p.stId'
    );
  });

  it('is a 404 naming the resource and identifier as given', async () => {
    rows = [];
    expect(await messages(await get('GO/GO:0006915/reactions'))).toEqual([
      404,
      ['No reactions found for GO:GO:0006915'],
    ]);
    asked.length = 0;
    // A GO identifier with no digits is nothing to look for.
    expect(await messages(await get('GO/GO:/pathways'))).toEqual([
      404,
      ['No pathways found for GO:GO:'],
    ]);
    expect(mapped()).toEqual([]);
  });
});
