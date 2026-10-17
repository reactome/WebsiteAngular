// @vitest-environment node
//
// /data/complex/{id}/subunits and /data/complexes/{resource}/{identifier} --
// what a complex is made of, and the complexes an identifier is part of --
// with a stand-in graph. PhysicalEntityController over graph-core's
// PhysicalEntityRepository, whose queries are kept as written. The entities
// here are invented; Java's messages were measured 17 Oct 2026.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked = [];
let rows = [];
let failure;
vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    asked.push([cypher, params]);
    if (failure) throw failure;
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

const get = (path) => fetch(`${base}/ContentService/data/${path}`);
const last = () => asked[asked.length - 1];
const oneLine = (cypher) => cypher.replace(/\s+/g, ' ').trim();
const entity = (dbId, schemaClass) => ({
  dbId,
  stId: `R-HSA-${dbId}`,
  displayName: `E${dbId}`,
  schemaClass,
});
const messages = async (response) => [response.status, (await response.json()).messages];

describe('/data/complex/{id}/subunits', () => {
  it("runs graph-core's query as written and writes the entities in the rows' order", async () => {
    rows = [{ pe: entity(2, 'Complex') }, { pe: entity(1, 'EntityWithAccessionedSequence') }];
    failure = undefined;
    asked.length = 0;
    const response = await get('complex/R-HSA-5/subunits');
    expect((await response.json()).map((e) => e.dbId)).toEqual([2, 1]);
    expect(oneLine(last()[0])).toBe(
      'MATCH (:PhysicalEntity{stId: $id})-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe:PhysicalEntity) RETURN DISTINCT pe'
    );
    expect(last()[1]).toEqual({ id: 'R-HSA-5' });
  });

  it('leaves out complexes and sets when asked, by a dbId', async () => {
    rows = [{ pe: entity(1, 'EntityWithAccessionedSequence') }];
    asked.length = 0;
    await get('complex/5/subunits?excludeStructures=true');
    expect(oneLine(last()[0])).toBe(
      'MATCH (:PhysicalEntity{dbId: toInteger($id)})-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe:PhysicalEntity) WHERE NOT (pe:Complex) AND NOT(pe:EntitySet) RETURN DISTINCT pe'
    );
  });

  it("is Java's 500 for excludeStructures with a stable id: graph-core's query has no stId to read", async () => {
    asked.length = 0;
    for (const id of ['R-HSA-5', 'REACT_13069']) {
      const response = await get(`complex/${id}/subunits?excludeStructures=yes`);
      expect([id, ...(await messages(response))]).toEqual([
        id,
        500,
        [
          "Expected parameter(s): stId; Error code 'Neo.ClientError.Statement.ParameterMissing'; nested exception is org.neo4j.driver.exceptions.ClientException: Expected parameter(s): stId",
        ],
      ]);
    }
  });

  it('reads excludeStructures as Spring reads a primitive boolean: 400 for what it cannot', async () => {
    const response = await get('complex/R-HSA-5/subunits?excludeStructures=x');
    expect(await messages(response)).toEqual([
      400,
      [
        "Failed to convert value of type 'java.lang.String' to required type 'boolean'; nested exception is java.lang.IllegalArgumentException: Invalid boolean value [x]",
      ],
    ]);
    // Even for an id it would not find: the parameter is bound first.
    expect((await get('complex/xyz/subunits?excludeStructures=x')).status).toBe(400);
  });

  it('is a 404 naming the id for one that is neither, or has no subunits', async () => {
    rows = [];
    for (const id of ['xyz', 'R-HSA-199420']) {
      expect([id, ...(await messages(await get(`complex/${id}/subunits`)))]).toEqual([
        id,
        404,
        [`Id: ${id} has not been found in the System`],
      ]);
    }
    expect((await get('complex/xyz/subunits?excludeStructures=true')).status).toBe(404);
  });
});

describe('/data/complexes/{resource}/{identifier}', () => {
  it("runs graph-core's query, the resource a regular expression as Java passes it", async () => {
    rows = [{ c: entity(3, 'Complex') }];
    failure = undefined;
    asked.length = 0;
    const response = await get('complexes/(%3Fi)uniprot/P00533');
    expect((await response.json()).map((e) => e.dbId)).toEqual([3]);
    expect(oneLine(last()[0])).toBe(
      'MATCH (rd:ReferenceDatabase)<-[:referenceDatabase]-(n{identifier:$identifier}) WHERE rd.displayName =~ $resource WITH DISTINCT n MATCH (n)<-[:referenceEntity|referenceSequence|crossReference|referenceGene*]-(pe:PhysicalEntity) WITH DISTINCT pe MATCH (c:Complex)-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe) RETURN DISTINCT c'
    );
    expect(last()[1]).toEqual({ identifier: 'P00533', resource: '(?i)uniprot' });
  });

  it('reads both as Spring reads path variables: decoded, matrix parameters cut', async () => {
    rows = [{ c: entity(3, 'Complex') }];
    failure = undefined;
    asked.length = 0;
    await get('complexes/Uni%20Prot;a=b/P00533;x=1/');
    expect(last()[1]).toEqual({ identifier: 'P00533', resource: 'Uni Prot' });
  });

  it("turns only a regular expression Neo4j cannot read into Java's 500", async () => {
    // Anything else is not Java's to mirror: it is not dressed in Java's words.
    for (const other of [
      { code: 'Neo.TransientError.General.DatabaseUnavailable', message: 'Invalid Regex: x' },
      { code: 'Neo.ClientError.Statement.SemanticError', message: 'Something else' },
    ]) {
      failure = Object.assign(new Error(other.message), { code: other.code });
      const response = await get('complexes/UniProt/P00533');
      failure = undefined;
      const body = await response.text();
      expect([other.code, body.includes("Error code '")]).toEqual([other.code, false]);
    }
  });

  it('is a 404 naming both, identifier first', async () => {
    rows = [];
    expect(await messages(await get('complexes/uniprot/P00533'))).toEqual([
      404,
      ['No complexes found for (P00533, uniprot)'],
    ]);
  });

  it("is Java's 500 for a resource Neo4j cannot read as a regular expression", async () => {
    failure = Object.assign(
      new Error('Invalid Regex: Unclosed character class near index 0\n[\n^'),
      {
        code: 'Neo.ClientError.Statement.SemanticError',
      }
    );
    const response = await get('complexes/%5B/P00533');
    failure = undefined;
    expect(await messages(response)).toEqual([
      500,
      [
        "Invalid Regex: Unclosed character class near index 0\n[\n^; Error code 'Neo.ClientError.Statement.SemanticError'; nested exception is org.neo4j.driver.exceptions.ClientException: Invalid Regex: Unclosed character class near index 0\n[\n^",
      ],
    ]);
  });
});
