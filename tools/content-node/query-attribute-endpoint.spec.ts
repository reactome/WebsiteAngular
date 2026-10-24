// @vitest-environment node
//
// /data/query/{id}/{attributeName} and /data/person/{id}/{attributeName}
// through the service, with a stand-in graph: the object findById loads, then
// what LazyFetchAspect would load for a getter whose relationship is empty.
// The objects here are invented; Java's answers were measured 18 Oct 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** The object findById loads; none, for an id the graph does not hold. */
let root: GraphNode | undefined;
/** The lazy loads' rows, by `${type} ${direction} ${dbId}`. */
let lazy: Record<string, unknown[]> = {};
const asked: string[] = [];
// The lazy loads by what they ask: `${type} ${direction} ${dbId}`, read from
// the query and its parameter -- a load in the wrong direction, or of
// another object, finds nothing. Directions are Java's model's
// (domain-snapshot.json): an edit's `modified` comes in to the object, and
// so does the `hasComponent` behind a complex's componentOf.
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: { dbId?: unknown }) => {
    asked.push(cypher);
    // /query/{id}/stId's and /query/{id}/normalPathway's own queries.
    if (/n\.stId AS stId, n\.schemaClass AS schemaClass/.test(cypher))
      return root ? [{ stId: root.props.stId ?? null, schemaClass: root.props.schemaClass }] : [];
    if (/\[:normalPathway\]/.test(cypher))
      return root
        ? [{ labels: root.labels, dbId: null, stId: null, displayName: null, targetLabels: null }]
        : [];
    if (/RETURN labels\(n\) AS labels/.test(cypher)) return root ? [{ labels: root.labels }] : [];
    if (/AS root/.test(cypher))
      return root ? [{ root, order: [], nodes: [], relationships: [] }] : [];
    const load = /\{dbId:\$dbId\}\)(<-|-)\[r:(\w+)\](->|-)/.exec(cypher);
    if (load) {
      const direction = load[1] === '<-' ? 'INCOMING' : 'OUTGOING';
      return lazy[`${load[2]} ${direction} ${Number(params.dbId)}`] ?? [];
    }
    return [];
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

const get = (path: string) => fetch(`${base}/ContentService/data/${path}`);
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];
const pathway = {
  id: 1,
  labels: ['DatabaseObject', 'Event', 'Pathway'],
  props: { dbId: 9, stId: 'R-HSA-9', displayName: 'P', schemaClass: 'Pathway' },
};
const loaded = (id: number, schemaClass: string, labels: string[], n: number | null = null) => ({
  m: {
    id,
    labels: ['DatabaseObject', ...labels],
    props: { dbId: id, stId: `R-HSA-${id}`, displayName: `o${id}`, schemaClass },
  },
  n,
});

describe('a single object loaded lazily', () => {
  it("is the one there is, asked for by the getter's class", async () => {
    root = pathway;
    lazy = { 'modified INCOMING 9': [loaded(20, 'InstanceEdit', ['InstanceEdit'])] };
    asked.length = 0;
    const response = await get('query/R-HSA-9/modified');
    expect([response.status, await response.text()]).toEqual([200, 'R-HSA-20\to20\tInstanceEdit']);
    expect(asked.find((cypher) => cypher.includes('[r:modified]'))).toMatch(/\(m:InstanceEdit\)/);
  });

  it("is nothing when there are two, as findByRelationship gives: Java's 404", async () => {
    root = pathway;
    lazy = {
      'modified INCOMING 9': [
        loaded(20, 'InstanceEdit', ['InstanceEdit']),
        loaded(21, 'InstanceEdit', ['InstanceEdit']),
      ],
    };
    expect(await messages(await get('query/R-HSA-9/modified'))).toEqual([
      404,
      ["Attribute: 'modified' has not been found for object: Pathway"],
    ]);
  });
});

describe('a collection loaded lazily', () => {
  it('lists each object as many times as its stoichiometry', async () => {
    root = {
      id: 2,
      labels: ['DatabaseObject', 'PhysicalEntity', 'Complex'],
      props: { dbId: 5, stId: 'R-HSA-5', displayName: 'C', schemaClass: 'Complex' },
    };
    // The complexes it is a component of: hasComponent, coming in.
    lazy = {
      'hasComponent INCOMING 5': [loaded(30, 'Complex', ['PhysicalEntity', 'Complex'], 2)],
    };
    const response = await get('query/R-HSA-5/componentOf');
    expect(await response.text()).toBe('R-HSA-30\to30\tComplex\nR-HSA-30\to30\tComplex\n');
  });
});

describe('the attribute as it was sent', () => {
  // Routing matches stId and normalPathway in any case; Java's 404 names
  // the attribute as the request spelled it.
  it("is named in /query/{id}/stId's 404 for an object without a stable id", async () => {
    root = {
      id: 6,
      labels: ['DatabaseObject', 'Taxon', 'Species'],
      props: { dbId: 48887, displayName: 'Homo sapiens', schemaClass: 'Species' },
    };
    for (const spelled of ['stId', 'STID', 'StId'])
      expect(await messages(await get(`query/48887/${spelled}`))).toEqual([
        404,
        [`Attribute: '${spelled}' has not been found for object: Species`],
      ]);
  });

  it("is named in /query/{id}/normalPathway's 404 for an object without one", async () => {
    root = pathway;
    for (const spelled of ['normalPathway', 'NormalPathway', 'NORMALPATHWAY'])
      expect(await messages(await get(`query/R-HSA-9/${spelled}`))).toEqual([
        404,
        [`Attribute: '${spelled}' has not been found for object: Pathway`],
      ]);
  });
});

describe('stId and normalPathway in any case', () => {
  // Their own routes, the light query each makes, never the general route's
  // load of the whole object -- whose answer, being Java's, is the same, so
  // only the query asked says which route answered.
  it('are answered by their own routes, not /query/{id}/{attribute}', async () => {
    root = pathway;
    for (const [spelled, own] of [
      ['stid', /n\.stId AS stId, n\.schemaClass AS schemaClass/],
      ['STID', /n\.stId AS stId, n\.schemaClass AS schemaClass/],
      ['normalpathway', /\[:normalPathway\]/],
      ['NormalPathway', /\[:normalPathway\]/],
    ] as const) {
      asked.length = 0;
      await get(`query/R-HSA-9/${spelled}`);
      expect([
        spelled,
        asked.some((cypher) => own.test(cypher)),
        asked.some((cypher) => /AS root/.test(cypher)),
      ]).toEqual([spelled, true, false]);
    }
  });
});

describe("Java's other answers", () => {
  it("leaves Java's own /query/abridged/{id}, /query/enhanced/{id} and /query/{id}/more alone", async () => {
    root = pathway;
    for (const path of ['query/abridged/R-HSA-9', 'query/R-HSA-9/more']) {
      const response = await get(path);
      expect([path, response.status, ((await response.json()) as { error: string }).error]).toEqual(
        [path, 404, 'Not Found']
      );
    }
  });

  it("is Java's 500 for a getter that fails, and its 404s for no object or no attribute", async () => {
    root = {
      id: 3,
      labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceGeneProduct'],
      props: { dbId: 17, schemaClass: 'ReferenceGeneProduct' },
    };
    lazy = {};
    const failed = await get('query/17/simplifiedDatabaseName');
    expect([failed.status, ((await failed.json()) as { reason: string }).reason]).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
    ]);
    expect(await messages(await get('query/17/xyz'))).toEqual([
      404,
      ["Attribute: 'xyz' has not been found for object: ReferenceGeneProduct"],
    ]);
    root = undefined;
    expect(await messages(await get('query/R-HSA-0/displayName'))).toEqual([
      404,
      ['Id: R-HSA-0 has not been found in the System'],
    ]);
  });
});

describe('/data/person/{id}/{attributeName}', () => {
  it('reads the id as a path variable, and names a person not found', async () => {
    root = {
      id: 4,
      labels: ['DatabaseObject', 'Person'],
      props: { dbId: 68285, displayName: 'D', schemaClass: 'Person' },
    };
    asked.length = 0;
    const response = await get('person/68285/displayName');
    expect([response.status, await response.text()]).toEqual([200, 'D']);
    root = undefined;
    expect(await messages(await get('person/68286/displayName'))).toEqual([
      404,
      ['No person found for id: 68286'],
    ]);
  });
});
