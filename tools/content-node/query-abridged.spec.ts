// @vitest-environment node
//
// /data/query/abridged/{id}, /data/query/abridged/{id}/{attributeName} and
// /data/query/{id}/more (spec 006 T104) through the service, with a stand-in
// graph. The objects' properties are those Java wrote for them, with a
// property the node holds and Java does not write; the expected bodies are
// Java's answers, measured 7 Nov 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from './graph.ts';

/** The nodes by stable id and dbId, as the abridged query finds them. */
const nodes: GraphNode[] = [
  {
    id: 1,
    labels: ['DatabaseObject', 'Event', 'Pathway'],
    props: {
      dbId: 109581,
      displayName: 'Apoptosis',
      stId: 'R-HSA-109581',
      stIdVersion: 'R-HSA-109581.6',
      oldStId: 'REACT_578',
      isInDisease: false,
      isInferred: false,
      maxDepth: 7,
      name: ['Apoptosis'],
      releaseDate: '2004-09-20',
      speciesName: 'Homo sapiens',
      hasDiagram: true,
      hasEHLD: true,
      lastUpdatedDate: '2022-06-09',
      schemaClass: 'Pathway',
    },
  },
  {
    id: 2,
    labels: ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'Reaction'],
    props: {
      dbId: 70486,
      displayName: 'PGK complexes (PGK1,2) phosphorylate 3PG to form 1,3BPG',
      stId: 'R-HSA-70486',
      stIdVersion: 'R-HSA-70486.7',
      oldStId: 'REACT_1186',
      isInDisease: false,
      isInferred: false,
      maxDepth: 1,
      name: [
        'PGK complexes (PGK1,2) phosphorylate 3PG to form 1,3BPG',
        '(2R)-3-phosphoglycerate + ATP => (2R)-3-phospho-glyceroyl phosphate + ADP',
      ],
      releaseDate: '2004-07-06',
      speciesName: 'Homo sapiens',
      category: 'transition',
      schemaClass: 'Reaction',
    },
  },
  {
    id: 3,
    labels: ['DatabaseObject', 'Taxon', 'Species'],
    props: {
      dbId: 48887,
      displayName: 'Homo sapiens',
      name: ['Homo sapiens', 'H. sapiens', 'Hs', 'human', 'man'],
      taxId: '9606',
      abbreviation: 'HSA',
      schemaClass: 'Species',
    },
  },
];

/** Java's answers for the three, as written. */
const JAVA = {
  109581:
    '{"dbId":109581,"displayName":"Apoptosis","stId":"R-HSA-109581","stIdVersion":"R-HSA-109581.6","isInDisease":false,"isInferred":false,"maxDepth":7,"name":["Apoptosis"],"releaseDate":"2004-09-20","speciesName":"Homo sapiens","hasDiagram":true,"hasEHLD":true,"lastUpdatedDate":"2022-06-09","schemaClass":"Pathway","className":"Pathway"}',
  70486:
    '{"dbId":70486,"displayName":"PGK complexes (PGK1,2) phosphorylate 3PG to form 1,3BPG","stId":"R-HSA-70486","stIdVersion":"R-HSA-70486.7","isInDisease":false,"isInferred":false,"maxDepth":1,"name":["PGK complexes (PGK1,2) phosphorylate 3PG to form 1,3BPG","(2R)-3-phosphoglycerate + ATP => (2R)-3-phospho-glyceroyl phosphate + ADP"],"releaseDate":"2004-07-06","speciesName":"Homo sapiens","category":"transition","className":"Reaction","schemaClass":"Reaction"}',
  48887:
    '{"dbId":48887,"displayName":"Homo sapiens","name":["Homo sapiens","H. sapiens","Hs","human","man"],"taxId":"9606","abbreviation":"HSA","className":"Species","schemaClass":"Species"}',
};

/** The pathway's events, as a lazy load of `hasEvent` finds them. */
const events = [5357769, 109606, 75153, 169911].map((dbId, i) => ({
  m: {
    id: 10 + i,
    labels: ['DatabaseObject', 'Event', 'Pathway'],
    props: { dbId, stId: `R-HSA-${dbId}`, displayName: `Event ${i}`, schemaClass: 'Pathway' },
  },
  n: null,
}));

const asked: string[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: { id?: unknown; dbId?: unknown }) => {
    asked.push(cypher);
    // findNewStId: the old id's stable id.
    if (cypher.includes('n.oldStId = $id'))
      return nodes
        .filter((node) => node.props['oldStId'] === params.id)
        .map((node) => ({ stId: node.props['stId'] }));
    // findByIdNoRelations: the node alone.
    const alone =
      /^MATCH \(n:DatabaseObject\{(stId|dbId): (\$id|toInteger\(\$id\))\}\) RETURN/.exec(cypher);
    if (alone)
      return nodes
        .filter((node) => String(node.props[alone[1] ?? '']) === String(params.id))
        .map((node) => ({ n: node }));
    if (cypher.includes('[r:hasEvent]->')) return Number(params.dbId) === 109581 ? events : [];
    // The enhanced query: nothing, so each lookup is seen.
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

const get = (path: string) => fetch(`${base}/ContentService/data/query/${path}`);
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response) => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];

describe('/query/abridged/{id}', () => {
  it("is the object's own properties, written as Java writes them", async () => {
    for (const [path, dbId] of [
      ['abridged/R-HSA-109581', 109581],
      ['abridged/R-HSA-70486', 70486],
      ['abridged/48887', 48887],
      // A version cut, an old id swapped for its stable id, a padded id.
      ['abridged/R-HSA-109581.6', 109581],
      ['abridged/REACT_578', 109581],
      ['abridged/%20R-HSA-109581', 109581],
      ['abridged/R-HSA-109581/', 109581],
    ] as const) {
      const response = await get(path);
      expect([path, response.status, await response.text()]).toEqual([path, 200, JAVA[dbId]]);
    }
  });

  it('loads the node alone, not its relationships', async () => {
    asked.length = 0;
    await get('abridged/R-HSA-109581');
    expect(asked).toEqual([
      'MATCH (n:DatabaseObject{stId: $id}) RETURN {id: id(n), labels: labels(n), props: properties(n)} AS n',
    ]);
  });

  it("is Java's 404 naming the id as sent, its 500 for dots alone", async () => {
    expect(await messages(await get('abridged/R-HSA-0'))).toEqual([
      404,
      ['Id: R-HSA-0 has not been found in the System'],
    ]);
    expect(await messages(await get('abridged/xyz'))).toEqual([
      404,
      ['Id: xyz has not been found in the System'],
    ]);
    // Java's /query/abridged/{id} takes this path, not /query/{id}/more.
    expect(await messages(await get('abridged/more'))).toEqual([
      404,
      ['Id: more has not been found in the System'],
    ]);
    expect(await messages(await get('abridged/...'))).toEqual([
      500,
      ['Index 0 out of bounds for length 0'],
    ]);
  });
});

describe('/query/abridged/{id}/{attributeName}', () => {
  it('loads a relationship the object came without, outgoing too', async () => {
    for (const attribute of ['hasEvent', 'hasevent']) {
      const response = await get(`abridged/R-HSA-109581/${attribute}`);
      expect([response.status, await response.text()]).toEqual([
        200,
        'R-HSA-5357769\tEvent 0\tPathway\nR-HSA-109606\tEvent 1\tPathway\nR-HSA-75153\tEvent 2\tPathway\nR-HSA-169911\tEvent 3\tPathway\n',
      ]);
    }
  });

  it('reads a property, and the stable id, as /query/{id}/{attribute} does', async () => {
    const name = await get('abridged/R-HSA-109581/displayName');
    expect([name.status, await name.text()]).toEqual([200, 'Apoptosis']);
    const stId = await get('abridged/109581/stid');
    expect([stId.status, await stId.text()]).toEqual([200, 'R-HSA-109581']);
  });

  it("is Java's 404 naming the attribute, or the id", async () => {
    expect(await messages(await get('abridged/R-HSA-109581/foo'))).toEqual([
      404,
      ["Attribute: 'foo' has not been found for object: Pathway"],
    ]);
    expect(await messages(await get('abridged/R-HSA-109581/more'))).toEqual([
      404,
      ["Attribute: 'more' has not been found for object: Pathway"],
    ]);
    expect(await messages(await get('abridged/xyz/stId'))).toEqual([
      404,
      ['Id: xyz has not been found in the System'],
    ]);
  });
});

describe('/query/{id}/more', () => {
  it('is /query/enhanced/v2/{id} without disease data, then with it', async () => {
    asked.length = 0;
    expect(await messages(await get('R-HSA-70486/more'))).toEqual([
      404,
      ['Id: R-HSA-70486 has not been found in the System'],
    ]);
    const lookups = asked.filter((cypher) => cypher.includes('NOT m:UpdateTracker'));
    expect(lookups.map((cypher) => cypher.includes('isInDisease = false'))).toEqual([true, false]);
  });

  it("asks the graph what v2 asks with /more's flags", async () => {
    asked.length = 0;
    await get('R-HSA-70486/more');
    const more = [...asked];
    asked.length = 0;
    await get(
      'enhanced/v2/R-HSA-70486?fetchIncomingRelationships=true&summariseReferenceEntity=false&includeDisease=false'
    );
    expect(more).toEqual(asked);
    expect(more.length).toBeGreaterThan(0);
  });

  it('reads no parameter: a value v2 would refuse is no 400', async () => {
    expect((await get('R-HSA-70486/more?includeDisease=x')).status).toBe(404);
    expect((await get('enhanced/v2/R-HSA-70486?includeDisease=x')).status).toBe(400);
  });

  it("is Java's 500 for dots alone, as v2 is", async () => {
    for (const path of ['.../more', 'enhanced/v2/...', 'enhanced/...'])
      expect(await messages(await get(path))).toEqual([
        500,
        ['Index 0 out of bounds for length 0'],
      ]);
  });

  it('is an attribute called MORE in another case', async () => {
    // Spring's literal `more` is matched by case; the attribute route takes it,
    // asking and answering just as it does for any other attribute name.
    asked.length = 0;
    const more = await messages(await get('R-HSA-70486/MORE'));
    const moreAsked = [...asked];
    asked.length = 0;
    const other = await messages(await get('R-HSA-70486/foo'));
    expect([more, moreAsked]).toEqual([other, [...asked]]);
    expect(moreAsked.length).toBeGreaterThan(0);
    expect(moreAsked.some((cypher) => cypher.includes('NOT m:UpdateTracker'))).toBe(false);
  });
});
