// @vitest-environment node
//
// /interactors/static/molecule/{acc}/summary, POST /interactors/static/molecules/summary
// and /interactors/static/molecule/{acc}/pathways -- how many IntAct
// interactors an accession has, and the lower-level pathways its interactors
// are drawn in -- with a stand-in graph. StaticInteractionsController and
// InteractionManager over graph-core's InteractorCountRepository and
// PathwayRepository, their queries kept as written. The counts here are
// invented; Java's answers were measured 17 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let answer = () => [];
const asked = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    return answer(cypher, params);
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./service.ts');

let base;
let server;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const get = (path) => fetch(`${base}/ContentService/interactors/static/${path}`);
const post = (body, type = 'text/plain') =>
  fetch(`${base}/ContentService/interactors/static/molecules/summary`, {
    method: 'POST',
    headers: type ? { 'content-type': type } : {},
    body,
  });
const messages = async (response) => [response.status, (await response.json()).messages];
const last = () => asked[asked.length - 1];
const oneLine = (cypher) => cypher.replace(/\s+/g, ' ').trim();

const COUNT =
  'MATCH (t:ReferenceEntity)<-[:interactor]-(in:Interaction) WHERE t.variantIdentifier IN $accs OR (t.variantIdentifier IS NULL AND t.identifier IN $accs) RETURN DISTINCT t.identifier AS s, COUNT(DISTINCT in) as t';

describe('/interactors/static/molecule/{acc}/summary', () => {
  it("counts with graph-core's query, keyed by the reference entity's identifier", async () => {
    answer = () => [{ s: 'P1', t: 7 }];
    asked.length = 0;
    const response = await get('molecule/P1-2/summary');
    expect(await response.text()).toBe('{"resource":"static","entities":[{"acc":"P1","count":7}]}');
    expect(oneLine(last()[0])).toBe(COUNT);
    expect(last()[1]).toEqual({ accs: ['P1-2'] });
  });

  it('is a 404 naming the accession for none', async () => {
    answer = () => [];
    expect(await messages(await get('molecule/xyz/summary'))).toEqual([
      404,
      ['No interactors found for accession: xyz'],
    ]);
  });
});

describe('POST /interactors/static/molecules/summary', () => {
  it("writes the counts in a HashMap's order, the accessions split and trimmed", async () => {
    answer = () => [
      { s: 'P04637', t: 249 },
      { s: 'Q00987', t: 78 },
    ];
    asked.length = 0;
    const response = await post('P04637, Q00987;xyz');
    expect(await response.text()).toBe(
      '{"resource":"static","entities":[{"acc":"Q00987","count":78},{"acc":"P04637","count":249}]}'
    );
    expect([...last()[1].accs].sort()).toEqual(['P04637', 'Q00987', 'xyz']);
    // Newline and tab separate too.
    await post('P1\nP2\tP3');
    expect([...last()[1].accs].sort()).toEqual(['P1', 'P2', 'P3']);
  });

  it("answers Java's errors: 415, 422, and a 404 naming the body as sent", async () => {
    expect(await messages(await post('P1', 'application/json'))).toEqual([
      415,
      ["Content type 'application/json' not supported"],
    ]);
    expect(await messages(await post(undefined))).toEqual([
      422,
      [
        'Required request body is missing: public org.reactome.server.service.model.interactors.Interactors org.reactome.server.service.controller.interactors.StaticInteractionsController.getProteinsSummaryByAccs(java.lang.String)',
      ],
    ]);
    answer = () => [];
    expect(await messages(await post('xyz, abc'))).toEqual([
      404,
      ['No interactors found for accession: xyz, abc'],
    ]);
  });
});

describe('/interactors/static/molecule/{acc}/pathways', () => {
  it("runs graph-core's lower-level query with the species name as given", async () => {
    answer = () => [{ p: { dbId: 3, stId: 'R-HSA-3', schemaClass: 'Pathway' } }];
    asked.length = 0;
    const response = await get('molecule/P1/pathways?species=Homo%20sapiens');
    expect((await response.json()).map((p) => p.dbId)).toEqual([3]);
    expect(oneLine(last()[0])).toBe(
      'MATCH (a:ReferenceEntity)<-[:interactor]-()-[:interactor]->(b:ReferenceEntity) WHERE a.identifier = $acc OR a.variantIdentifier = $acc MATCH path=(p:Pathway)-[:hasEvent|input|output|catalystActivity|physicalEntity|regulatedBy|regulator*]->(pe:PhysicalEntity)-[:referenceEntity]->(b) WHERE p.speciesName = $speciesName AND SINGLE(e IN NODES(path) WHERE (e:Pathway)) RETURN DISTINCT p'
    );
    expect(last()[1]).toEqual({ acc: 'P1', speciesName: 'Homo sapiens' });
  });

  it('asks the diagrammed query when onlyDiagrammed, a Boolean as Spring reads one', async () => {
    answer = () => [{ p: { dbId: 3, schemaClass: 'Pathway' } }];
    await get('molecule/P1/pathways?species=Homo%20sapiens&onlyDiagrammed=yes');
    expect(oneLine(last()[0])).toBe(
      'MATCH (a:ReferenceEntity)<-[:interactor]-()-[:interactor]->(b:ReferenceEntity) WHERE a.identifier = $acc OR a.variantIdentifier = $acc MATCH path=(p:Pathway{hasDiagram:True})-[:hasEvent|input|output|catalystActivity|physicalEntity|regulatedBy|regulator*]->(pe:PhysicalEntity)-[:referenceEntity]->(b) WHERE p.speciesName = $speciesName AND SINGLE(e IN NODES(path) WHERE (e:Pathway) AND e.hasDiagram) RETURN DISTINCT p'
    );
    const bad = await get('molecule/P1/pathways?onlyDiagrammed=x');
    expect((await messages(bad))[0]).toBe(400);
  });

  it('joins a repeated species as Spring does', async () => {
    answer = () => [{ p: { dbId: 3, schemaClass: 'Pathway' } }];
    await get('molecule/P1/pathways?species=A&species=B');
    expect(last()[1].speciesName).toBe('A,B');
  });

  it('is a 404 with no species, which matches nothing', async () => {
    answer = (cypher, params) => (params.speciesName === null ? [] : [{ p: { dbId: 3 } }]);
    expect(await messages(await get('molecule/P1/pathways'))).toEqual([
      404,
      ['No pathways found for molecule: P1'],
    ]);
  });
});
