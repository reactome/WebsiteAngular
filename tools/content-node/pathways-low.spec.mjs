// @vitest-environment node
//
// /data/pathways/low/entity/{id}/allForms, /data/pathways/low/diagram/entity/{id}
// and /data/pathways/low/diagram/entity/{id}/allForms -- the lower-level
// pathways of an entity, of every form of it, and the diagrams they are drawn
// in -- with a stand-in graph. PathwaysService dispatches each as it does
// /low/entity/{id}: a stable id or a dbId, each with or without a species, to
// graph-core's PathwayRepository query, kept here as written. The pathways
// here are invented.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked = [];
let rows = [];
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    // speciesTaxId's lookup: 9606 is a species.
    if (/^MATCH \(s:Species/.test(cypher)) return [{ taxId: '9606' }];
    return rows;
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

const get = (path) => fetch(`${base}/ContentService/data/pathways/low/${path}`);
const node = (dbId, name) => ({
  dbId,
  stId: `R-HSA-${dbId}`,
  displayName: name,
  schemaClass: 'Pathway',
});
const last = () => asked[asked.length - 1];
const oneLine = (cypher) => cypher.replace(/\s+/g, ' ').trim();

describe('the three variants', () => {
  for (const [path, column, start] of [
    ['entity/R-HSA-1/allForms', 'p', 'MATCH (:DatabaseObject{stId: $id})-[:regulator|'],
    ['diagram/entity/R-HSA-1', 'm', 'MATCH (:PhysicalEntity{stId: $id})<-[:regulatedBy|'],
    ['diagram/entity/R-HSA-1/allForms', 'm', 'MATCH (:PhysicalEntity{stId: $id})-[:regulator|'],
  ])
    it(`${path} runs its own query and writes the pathways in the rows' order`, async () => {
      rows = [{ [column]: node(2, 'B') }, { [column]: node(1, 'A') }];
      asked.length = 0;
      const response = await get(path);
      expect(response.status).toBe(200);
      expect((await response.json()).map((p) => p.dbId)).toEqual([2, 1]);
      expect(oneLine(last()[0]).startsWith(start)).toBe(true);
      expect(last()[1].id).toBe('R-HSA-1');
    });
});

describe('/diagram/entity/{id}', () => {
  it('keeps the species patterns as graph-core writes them, the first without a label', async () => {
    rows = [{ m: node(1, 'A') }];
    asked.length = 0;
    await get('diagram/entity/1?species=9606');
    const cypher = oneLine(last()[0]);
    expect(cypher).toBe(
      'MATCH (:PhysicalEntity{dbId: toInteger($id)})<-[:regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|proteinMarker|RNAMarker*]-(r:ReactionLikeEvent)<-[:hasEvent*]-(p:Pathway{hasDiagram:True})-[:species]->(Species{taxId:$taxId}) WITH r, HEAD(COLLECT(p)) AS m RETURN DISTINCT m' +
        ' UNION MATCH (r:ReactionLikeEvent{dbId: toInteger($id)})<-[:hasEvent]-(p:Pathway{hasDiagram:True})-[:species]->(s:Species{taxId:$taxId}) WITH r, HEAD(COLLECT(p)) AS m RETURN DISTINCT m' +
        ' UNION MATCH (o:Pathway{dbId: toInteger($id)})-[:hasEvent*]->(p:Pathway{hasDiagram:True})-[:species]->(s:Species{taxId:$taxId}) WITH o, HEAD(COLLECT(p)) AS m RETURN DISTINCT m'
    );
    expect(last()[1]).toEqual({ id: '1', taxId: '9606' });
  });
});

describe('/entity/{id}/allForms and /diagram/entity/{id}/allForms', () => {
  it("are graph-core's queries as written, in a species", async () => {
    rows = [{ p: node(1, 'A') }];
    asked.length = 0;
    await get('entity/R-HSA-1/allForms?species=9606');
    expect(oneLine(last()[0])).toBe(
      'MATCH (:DatabaseObject{stId: $id})-[:regulator|hasComponent|repeatedUnit|hasMember|hasCandidate|referenceEntity|proteinMarker|RNAMarker*]->(re:ReferenceEntity) WITH re MATCH (re)<-[:referenceEntity]-(:PhysicalEntity)<-[:regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|proteinMarker|RNAMarker*]-(:ReactionLikeEvent)<-[:hasEvent]-(p:Pathway)-[:species]->(:Species{taxId:$taxId}) RETURN DISTINCT p'
    );

    rows = [{ m: node(1, 'A') }];
    await get('diagram/entity/R-HSA-1/allForms?species=9606');
    expect(oneLine(last()[0])).toBe(
      'MATCH (:PhysicalEntity{stId: $id})-[:regulator|hasComponent|repeatedUnit|hasMember|hasCandidate|referenceEntity|proteinMarker|RNAMarker*]->(re:ReferenceEntity) WITH re MATCH (re)<-[:referenceEntity]-(:PhysicalEntity)<-[:regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|proteinMarker|RNAMarker*]-(r:ReactionLikeEvent)<-[:hasEvent*]-(p:Pathway{hasDiagram:True})-[:species]->(Species{taxId:$taxId}) WITH r, HEAD(COLLECT(p)) AS m RETURN DISTINCT m'
    );
  });
});

describe("Java's 404", () => {
  it('names the id and the species as given, "null" when there is none', async () => {
    rows = [];
    for (const [path, message] of [
      ['diagram/entity/xyz', 'No result for xyz in null'],
      ['diagram/entity/xyz/allForms?species=9606', 'No result for xyz in 9606'],
      ['entity/xyz/allForms?species=Homo%20sapiens', 'No result for xyz in Homo sapiens'],
    ]) {
      const response = await get(path);
      expect([path, response.status, (await response.json()).messages]).toEqual([
        path,
        404,
        [message],
      ]);
    }
  });
});
