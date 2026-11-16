// @vitest-environment node
//
// /data/pathways/top/{species}/curated and
// /data/pathways/low/diagram/identifier/{identifier}/allForms through the
// service, with a stand-in graph (spec 006 T106): graph-core's queries as
// written, chosen as its services choose them, their records mapped as SDN
// maps them and written in the request's view; Neo4j's refusal of the
// identifier query without a species as Java's 500. The objects here are
// invented; Java's answers were measured 12 Nov 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** A query's parameters, as the service passes them. */
type Params = { [name: string]: unknown };
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
let rows: unknown[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params) => {
    asked.push([cypher, params]);
    // speciesTaxId's lookups: 9606 and Homo sapiens are a species.
    if (/^MATCH \(s:Species/.test(cypher))
      return params['value'] === '9606' || params['value'] === 'Homo sapiens'
        ? [{ taxId: '9606' }]
        : [];
    // What Neo4j does with a query that names a parameter it is not given.
    if (cypher.includes('$stId') && !('stId' in params))
      throw Object.assign(new Error('Expected parameter(s): stId'), {
        code: 'Neo.ClientError.Statement.ParameterMissing',
      });
    return rows;
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
beforeEach(() => {
  asked.length = 0;
  rows = [];
});

const get = (path: string) => fetch(`${base}/ContentService/data/pathways/${path}`);
/** The messages of Java's error envelope. */
const messages = async (response: Response) =>
  ((await response.json()) as { messages: string[] }).messages;
const last = () => {
  const query = asked.at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  return query;
};
const pathway = (id: number, dbId: number, name: string, top = false): GraphNode => ({
  id,
  labels: ['DatabaseObject', 'Event', 'Pathway', ...(top ? ['TopLevelPathway'] : [])],
  props: {
    dbId,
    stId: `R-HSA-${dbId}`,
    displayName: name,
    name: [name],
    schemaClass: top ? 'TopLevelPathway' : 'Pathway',
    isInferred: false,
    hasDiagram: true,
  },
});
const HUMAN: GraphNode = {
  id: 9,
  labels: ['DatabaseObject', 'Taxon', 'Species'],
  props: {
    dbId: 48887,
    displayName: 'Homo sapiens',
    name: ['Homo sapiens'],
    taxId: '9606',
    schemaClass: 'Species',
  },
};
const species = (id: number, start: number) => ({
  id,
  type: 'species',
  start,
  end: 9,
  props: { order: 0, stoichiometry: 1 },
});

describe('/top/{species}/curated', () => {
  const TOP = [
    { n: pathway(1, 10, 'A', true), 'collect(r)': [species(20, 1)], 'collect(s)': [HUMAN] },
    { n: pathway(2, 11, 'B', true), 'collect(r)': [species(21, 2)], 'collect(s)': [HUMAN] },
  ];

  it("asks graph-core's query by taxId for digits, by name for the rest, decoded once", async () => {
    await get('top/9606/curated');
    expect(last()[0]).toContain('(n:TopLevelPathway{isInferred:False})');
    expect(last()[0]).toContain('(s:Species{taxId:$taxId})');
    expect(last()[1]).toEqual({ taxId: '9606' });
    await get('top/Homo+sapiens%2B/curated');
    expect(last()[0]).toContain('(s:Species{displayName:$speciesName})');
    expect(last()[1]).toEqual({ speciesName: 'Homo+sapiens+' });
    // Decoded twice, %2520 would be a space.
    await get('top/Homo%2520sapiens/curated');
    expect(last()[1]).toEqual({ speciesName: 'Homo%20sapiens' });
  });

  it('answers none with the 404 naming the species as given', async () => {
    const response = await get('top/Homo%20sapien/curated');
    expect(response.status).toBe(404);
    expect(await messages(response)).toEqual([
      'No TopLevelPathways were found for species: Homo sapien',
    ]);
  });

  it('writes the mapped pathways, the species whole once and by its dbId after', async () => {
    rows = TOP;
    const response = await get('top/9606/curated');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { dbId: number; species: unknown[] }[];
    expect(body.map((p) => p.dbId)).toEqual([10, 11]);
    expect(body[0]?.species).toEqual([
      expect.objectContaining({ dbId: 48887, taxId: '9606', className: 'Species' }),
    ]);
    expect(body[1]?.species).toEqual([48887]);
  });

  it('gives JSOG ids with includeRef, as Java writes a domain object', async () => {
    rows = TOP;
    const text = await (await get('top/9606/curated?includeRef=true')).text();
    expect(text.startsWith('[{"@id":"1","dbId":10,')).toBe(true);
    expect(text).toContain('"species":[{"@ref":"2"}]');
  });
});

describe('/low/diagram/identifier/{identifier}/allForms', () => {
  const path = (query: string) => `low/diagram/identifier/pten/allForms${query}`;

  for (const query of ['', '?species=', '?species=xx', '?species=9606&species=10090'])
    it(`answers ${query || 'no species'} with Neo4j's refusal, as Java's 500`, async () => {
      const response = await get(path(query));
      expect(response.status).toBe(500);
      expect(await messages(response)).toEqual([
        "Expected parameter(s): stId; Error code 'Neo.ClientError.Statement.ParameterMissing'; " +
          'nested exception is org.neo4j.driver.exceptions.ClientException: Expected parameter(s): stId',
      ]);
      // graph-core's query as written, which names a parameter it never binds.
      expect(last()[0]).toMatch(/^MATCH \(rd:ReferenceDatabase\)<--\(n\)/);
      expect(last()[1]).toEqual({ identifier: 'PTEN' });
    });

  it('asks in the species found, the identifier upper-cased in both arms', async () => {
    await get(path('?species=homo_sapiens'));
    const [cypher, params] = last();
    expect(params).toEqual({ identifier: 'PTEN', taxId: '9606' });
    expect(cypher).toContain('(pe:PhysicalEntity{stId:$identifier})');
    // From the identifier up, the entities in the order Java's scan meets them.
    expect(cypher).toMatch(/^CALL \{ MATCH \(n:ReferenceEntity\) WHERE /);
    expect(cypher).toContain('WITH DISTINCT pe ORDER BY id(pe) MATCH (pe)<-');
    expect(cypher.match(/-\[:species\]->\(s:Species\{taxId:\$taxId\}\)/g)).toHaveLength(2);
  });

  it('answers none with the 404 naming the identifier and species as given', async () => {
    const response = await get(path('?species=9606'));
    expect(response.status).toBe(404);
    expect(await messages(response)).toEqual(['No result for pten in 9606']);
  });

  it('writes the pathways in the rows’ order, as domain objects', async () => {
    rows = [{ p: pathway(2, 22, 'B') }, { p: pathway(1, 21, 'A') }];
    const response = await get(path('?species=9606&includeRef=true'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { '@id': string; dbId: number; className: string }[];
    expect(body.map((p) => [p['@id'], p.dbId, p.className])).toEqual([
      ['1', 22, 'Pathway'],
      ['2', 21, 'Pathway'],
    ]);
  });
});
