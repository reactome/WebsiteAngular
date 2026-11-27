// @vitest-environment node
//
// /interactors/static/molecule/{acc}/summary, POST /interactors/static/molecules/summary
// and /interactors/static/molecule/{acc}/pathways -- how many IntAct
// interactors an accession has, and the lower-level pathways its interactors
// are drawn in -- with a stand-in graph. StaticInteractionsController and
// InteractionManager over graph-core's InteractorCountRepository and
// PathwayRepository, their queries kept as written. The counts here are
// invented; Java's answers were measured 17 Oct 2026, and the pathways'
// views and identities on 27 Nov 2026 (#953).
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** A query's parameters, as the service passes them. */
type Params = { accs?: string[]; speciesName?: string | null; [name: string]: unknown };
/** The stand-in graph's rows for a query. */
let answer: (cypher: string, params: Params) => unknown[] = () => [];
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params, options?: { graph?: boolean }) => {
    asked.push([cypher, params]);
    // As the driver: without `graph`, a node is its properties alone, so a
    // route that forgets `graph` reads what Neo4j would give it.
    const plain = (value: unknown): unknown =>
      value && typeof value === 'object' && 'props' in value && 'labels' in value
        ? (value as { props: unknown }).props
        : value;
    const rows = answer(cypher, params);
    return options?.graph
      ? rows
      : rows.map((row) =>
          row && typeof row === 'object'
            ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]))
            : row
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

const get = (path: string) => fetch(`${base}/ContentService/interactors/static/${path}`);
const post = (body: string | undefined, type = 'text/plain') =>
  fetch(`${base}/ContentService/interactors/static/molecules/summary`, {
    method: 'POST',
    headers: type ? { 'content-type': type } : {},
    ...(body === undefined ? {} : { body }),
  });
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];
/** The last query asked; none at all is the test's failure, not undefined. */
const last = () => {
  const query = asked.at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  return query;
};
const oneLine = (cypher: string) => cypher.replace(/\s+/g, ' ').trim();
/** A pathway node, as the driver gives it in graph mode. */
const pathway = (dbId: number, more: Record<string, unknown> = {}): GraphNode => ({
  id: dbId,
  labels: ['DatabaseObject', 'Event', 'Pathway'],
  props: { dbId, stId: `R-HSA-${dbId}`, displayName: `P${dbId}`, ...more, schemaClass: 'Pathway' },
});

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
    expect([...(last()[1].accs ?? [])].sort()).toEqual(['P04637', 'Q00987', 'xyz']);
    // Newline and tab separate too.
    await post('P1\nP2\tP3');
    expect([...(last()[1].accs ?? [])].sort()).toEqual(['P1', 'P2', 'P3']);
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
    answer = () => [{ p: pathway(3) }];
    asked.length = 0;
    const response = await get('molecule/P1/pathways?species=Homo%20sapiens');
    expect(((await response.json()) as { dbId: number }[]).map((p) => p.dbId)).toEqual([3]);
    expect(last()[0]).toBe(
      'MATCH (a:ReferenceEntity)<-[:interactor]-()-[:interactor]->(b:ReferenceEntity) WHERE a.identifier = $acc OR a.variantIdentifier = $acc MATCH path=(p:Pathway)-[:hasEvent|input|output|catalystActivity|physicalEntity|regulatedBy|regulator*]->(pe:PhysicalEntity)-[:referenceEntity]->(b) WHERE p.speciesName = $speciesName AND SINGLE(e IN NODES(path) WHERE (e:Pathway)) RETURN DISTINCT p'
    );
    expect(last()[1]).toEqual({ acc: 'P1', speciesName: 'Homo sapiens' });
  });

  it('asks the diagrammed query when onlyDiagrammed, a Boolean as Spring reads one', async () => {
    answer = () => [{ p: pathway(3) }];
    await get('molecule/P1/pathways?species=Homo%20sapiens&onlyDiagrammed=yes');
    expect(last()[0]).toBe(
      'MATCH (a:ReferenceEntity)<-[:interactor]-()-[:interactor]->(b:ReferenceEntity) WHERE a.identifier = $acc OR a.variantIdentifier = $acc MATCH path=(p:Pathway{hasDiagram:True})-[:hasEvent|input|output|catalystActivity|physicalEntity|regulatedBy|regulator*]->(pe:PhysicalEntity)-[:referenceEntity]->(b) WHERE p.speciesName = $speciesName AND SINGLE(e IN NODES(path) WHERE (e:Pathway) AND e.hasDiagram) RETURN DISTINCT p'
    );
    const bad = await get('molecule/P1/pathways?onlyDiagrammed=x');
    expect((await messages(bad))[0]).toBe(400);
  });

  it('joins a repeated species as Spring does', async () => {
    answer = () => [{ p: pathway(3) }];
    await get('molecule/P1/pathways?species=A&species=B');
    expect(last()[1].speciesName).toBe('A,B');
  });

  it('is a 404 with no species, which matches nothing', async () => {
    answer = (_cypher, params) => (params.speciesName === null ? [] : [{ p: pathway(3) }]);
    expect(await messages(await get('molecule/P1/pathways'))).toEqual([
      404,
      ['No pathways found for molecule: P1'],
    ]);
  });
});

describe("/interactors/static/molecule/{acc}/pathways, as Java's domain serialiser writes them (#953)", () => {
  const path = 'molecule/P1/pathways?species=Homo%20sapiens';

  it("writes a pathway's keys in Java's order, hasEHLD false where the node has none", async () => {
    answer = () => [{ p: pathway(3, { isInferred: false, hasDiagram: true, oldStId: 'REACT_3' }) }];
    expect(await (await get(path)).text()).toBe(
      '[{"dbId":3,"displayName":"P3","stId":"R-HSA-3","isInferred":false,"hasDiagram":true,"hasEHLD":false,"schemaClass":"Pathway","className":"Pathway"}]'
    );
  });

  it('gives JSOG ids with includeRef=true, in any case', async () => {
    answer = () => [{ p: pathway(4) }, { p: pathway(3) }];
    for (const value of ['true', 'TRUE']) {
      const text = await (await get(`${path}&includeRef=${value}`)).text();
      expect([value, text]).toEqual([
        value,
        '[{"@id":"1","dbId":4,"displayName":"P4","stId":"R-HSA-4","hasEHLD":false,"schemaClass":"Pathway","className":"Pathway"},' +
          '{"@id":"2","dbId":3,"displayName":"P3","stId":"R-HSA-3","hasEHLD":false,"schemaClass":"Pathway","className":"Pathway"}]',
      ]);
    }
  });

  it('gives none for another value (Boolean.parseBoolean)', async () => {
    answer = () => [{ p: pathway(3) }];
    for (const value of ['false', 'yes', '1', '']) {
      const text = await (await get(`${path}&includeRef=${value}`)).text();
      expect([value, text.startsWith('[{"dbId":3,')]).toEqual([value, true]);
    }
  });
});
