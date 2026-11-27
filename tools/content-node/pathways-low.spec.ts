// @vitest-environment node
//
// /data/pathways/low/entity/{id}/allForms, /data/pathways/low/diagram/entity/{id}
// and /data/pathways/low/diagram/entity/{id}/allForms -- the lower-level
// pathways of an entity, of every form of it, and the diagrams they are drawn
// in -- with a stand-in graph. PathwaysService dispatches each as it does
// /low/entity/{id}: a stable id or a dbId, each with or without a species, to
// graph-core's PathwayRepository query, kept here as written. The pathways
// here are invented.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** A query's parameters, as the service passes them. */
type Params = { id?: unknown; taxId?: unknown; [name: string]: unknown };
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
let rows: unknown[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params, options?: { graph?: boolean }) => {
    asked.push([cypher, params]);
    // As the driver: without `graph`, a node or relationship is its properties
    // alone, so a route that forgets `graph` reads what Neo4j would give it.
    const plain = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(plain)
        : value &&
            typeof value === 'object' &&
            'props' in value &&
            ('labels' in value || 'type' in value)
          ? (value as { props: unknown }).props
          : value;
    const answer = (found: unknown[]) =>
      options?.graph
        ? found
        : found.map((row) =>
            row && typeof row === 'object'
              ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]))
              : row
          );
    // speciesTaxId's lookup: 9606 is a species.
    if (/^MATCH \(s:Species/.test(cypher)) return [{ taxId: '9606' }];
    return answer(rows);
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

/** The messages of Java's error envelope. */
const messages = async (response: Response) =>
  ((await response.json()) as { messages: string[] }).messages;

const get = (path: string) => fetch(`${base}/ContentService/data/pathways/low/${path}`);
const node = (dbId: number, name: string): GraphNode => ({
  id: dbId,
  labels: ['DatabaseObject', 'Event', 'Pathway'],
  props: { dbId, stId: `R-HSA-${dbId}`, displayName: name, schemaClass: 'Pathway' },
});
/** The last query asked; none at all is the test's failure, not undefined. */
const last = () => {
  const query = asked.at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  return query;
};
const oneLine = (cypher: string) => cypher.replace(/\s+/g, ' ').trim();

describe('the three variants', () => {
  for (const [path, column, start] of [
    ['entity/R-HSA-1/allForms', 'p', 'MATCH (:DatabaseObject{stId: $id})-[:regulator|'],
    ['diagram/entity/R-HSA-1', 'm', 'MATCH (:PhysicalEntity{stId: $id})<-[:regulatedBy|'],
    ['diagram/entity/R-HSA-1/allForms', 'm', 'MATCH (:PhysicalEntity{stId: $id})-[:regulator|'],
  ] as const)
    it(`${path} runs its own query and writes the pathways in the rows' order`, async () => {
      rows = [{ [column]: node(2, 'B') }, { [column]: node(1, 'A') }];
      asked.length = 0;
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { dbId: number }[]).map((p) => p.dbId)).toEqual([2, 1]);
      expect(oneLine(last()[0]).startsWith(start)).toBe(true);
      expect(last()[1].id).toBe('R-HSA-1');
    });
});

describe('/entity/{id}', () => {
  it("is graph-core's three arms as written, in a species", async () => {
    rows = [{ p: node(1, 'A') }];
    asked.length = 0;
    await get('entity/R-HSA-1?species=9606');
    expect(oneLine(last()[0])).toBe(
      'MATCH (:DatabaseObject{stId: $id})<-[:regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|proteinMarker|RNAMarker*]-()<-[:hasEvent]-(p:Pathway)-[:species]->(:Species{taxId:$taxId}) RETURN DISTINCT p' +
        ' UNION MATCH (:ReactionLikeEvent{stId: $id})<-[:hasEvent]-(p:Pathway)-[:species]->(:Species{taxId:$taxId}) RETURN DISTINCT p' +
        ' UNION MATCH (p:Pathway{stId: $id})-[:species]->(:Species{taxId:$taxId}) RETURN DISTINCT p'
    );
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

describe('the view and identity Java writes domain objects in (#953)', () => {
  // Java's CustomMessageConverter writes these pathways as it writes every
  // domain object: with `includeRef=true` each starts with JSOG's "@id", and
  // without it there is none. Measured against Java on 27 Nov 2026.
  for (const [path, column] of [
    ['entity/R-HSA-1', 'p'],
    ['entity/R-HSA-1/allForms', 'p'],
    ['diagram/entity/R-HSA-1', 'm'],
    ['diagram/entity/R-HSA-1/allForms', 'm'],
  ] as const) {
    it(`${path} gives JSOG ids with includeRef=true`, async () => {
      rows = [{ [column]: node(2, 'B') }, { [column]: node(1, 'A') }];
      const text = await (await get(`${path}?includeRef=true`)).text();
      expect(text).toBe(
        '[{"@id":"1","dbId":2,"displayName":"B","stId":"R-HSA-2","hasEHLD":false,"schemaClass":"Pathway","className":"Pathway"},' +
          '{"@id":"2","dbId":1,"displayName":"A","stId":"R-HSA-1","hasEHLD":false,"schemaClass":"Pathway","className":"Pathway"}]'
      );
    });

    it(`${path} gives none without it, nor for another value (Boolean.parseBoolean)`, async () => {
      rows = [{ [column]: node(2, 'B') }];
      for (const query of ['', '?includeRef=false', '?includeRef=yes']) {
        const text = await (await get(`${path}${query}`)).text();
        expect([query, text]).toEqual([
          query,
          '[{"dbId":2,"displayName":"B","stId":"R-HSA-2","hasEHLD":false,"schemaClass":"Pathway","className":"Pathway"}]',
        ]);
      }
      const text = await (await get(`${path}?includeRef=TRUE`)).text();
      expect(text.startsWith('[{"@id":"1","dbId":2,')).toBe(true);
    });
  }
});

describe("Java's 404", () => {
  it('names the id and the species as given, "null" when there is none', async () => {
    rows = [];
    for (const [path, message] of [
      ['diagram/entity/xyz', 'No result for xyz in null'],
      ['diagram/entity/xyz/allForms?species=9606', 'No result for xyz in 9606'],
      ['entity/xyz/allForms?species=Homo%20sapiens', 'No result for xyz in Homo sapiens'],
    ] as const) {
      const response = await get(path);
      expect([path, response.status, await messages(response)]).toEqual([path, 404, [message]]);
    }
  });
});
