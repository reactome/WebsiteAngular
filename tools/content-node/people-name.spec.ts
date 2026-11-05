// @vitest-environment node
//
// /data/people/name/{name} and /exact -- people by name, as graph-core's
// PersonService splits and capitalises the name and PersonRepository matches
// it. The people, their names and their affiliation here are invented.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const asked: { cypher: string; params: Record<string, unknown> }[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Record<string, unknown> = {}) => {
    asked.push({ cypher, params });
    const names = params['name'] as string[];
    if (names.includes('Nobody')) return [];
    if (cypher.includes('LIMIT 1')) return [{ labels: ['DatabaseObject', 'Person'] }];
    const person = (id: number, dbId: number, firstname: string) => ({
      id,
      labels: ['DatabaseObject', 'Person'],
      props: {
        dbId,
        displayName: `Example, ${firstname}`,
        firstname,
        surname: 'Example',
        schemaClass: 'Person',
      },
    });
    const affiliation = {
      id: 9,
      labels: ['DatabaseObject', 'Affiliation'],
      props: {
        dbId: 90,
        displayName: 'An Institute',
        name: ['An Institute'],
        schemaClass: 'Affiliation',
      },
    };
    const publication = (id: number, dbId: number) => ({
      id,
      labels: ['DatabaseObject', 'Publication', 'LiteratureReference'],
      props: { dbId, displayName: `A paper ${dbId}`, schemaClass: 'LiteratureReference' },
    });
    // As findByIdQuery returns them: with the relationship's own id when the
    // query asks for it, and without one when it does not.
    const withIds = cypher.includes('{id: id(r)');
    const row = (root: ReturnType<typeof person>, paper: ReturnType<typeof publication>) => ({
      root,
      order: [affiliation.id, paper.id],
      nodes: [affiliation, paper],
      relationships: [
        { id: root.id * 100, type: 'affiliation', start: root.id, end: affiliation.id, props: {} },
        {
          id: root.id * 100 + 1,
          type: 'author',
          start: root.id,
          end: paper.id,
          props: { order: 0 },
        },
      ].map(({ id, ...relationship }) => (withIds ? { id, ...relationship } : relationship)),
    });
    return [
      row(person(1, 10, 'Ann'), publication(3, 30)),
      row(person(2, 20, 'Bea'), publication(4, 40)),
    ];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./server.ts');
const { personNames } = await import('./person-endpoints.ts');

let base: string;
let server: Server;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const people = (path: string) => fetch(`${base}/ContentService/data/people/name/${path}`);

describe('personNames, as PersonService reads a name', () => {
  it("splits on single spaces and upper-cases each part's first character only", () => {
    expect(personNames('ann example')).toEqual({ names: ['Ann', 'Example'] });
    expect(personNames('ANN mcExample')).toEqual({ names: ['ANN', 'McExample'] });
    expect(personNames('ann')).toEqual({ names: ['Ann'] });
  });

  it('upper-cases as String.toUpperCase does, one character becoming two', () => {
    expect(personNames('ßx')).toEqual({ names: ['SSx'] });
  });

  it('drops trailing empty parts, as String.split does', () => {
    expect(personNames('ann  ')).toEqual({ names: ['Ann'] });
    expect(personNames('   ')).toEqual({ names: [] });
  });

  it('fails on an empty part left in, as substring(0, 1) throws', () => {
    expect(personNames(' ann')).toEqual({ javaMessage: 'begin 0, end 1, length 0' });
    expect(personNames('ann  example')).toEqual({ javaMessage: 'begin 0, end 1, length 0' });
  });
});

describe('/data/people/name/{name}', () => {
  it("matches each part as a whole first name or surname: graph-core's OR, its AND for /exact", async () => {
    asked.length = 0;
    expect((await people('ann%20example')).status).toBe(200);
    expect((await people('ann%20example/exact')).status).toBe(200);
    const queries = asked.filter(({ cypher }) => !cypher.includes('LIMIT 1'));
    expect(
      queries.map(
        ({ cypher }) => /surname IN \$name (AND|OR) n\.firstname IN \$name/.exec(cypher)?.[1]
      )
    ).toEqual(['OR', 'AND']);
    // graph-core's own: people only, what they point to but InstanceEdits, in no order.
    for (const { cypher } of queries) {
      expect(cypher).toContain('MATCH (n:Person)');
      expect(cypher).toContain('WHERE NOT m:InstanceEdit');
      expect(cypher).not.toContain('ORDER BY');
    }
    expect(queries.map(({ params }) => params['name'])).toEqual([
      ['Ann', 'Example'],
      ['Ann', 'Example'],
    ]);
  });

  it('writes an affiliation two people share in full once, then by its dbId', async () => {
    const answer = (await (await people('example')).json()) as {
      dbId: number;
      affiliation: unknown[];
    }[];
    expect(answer.map((person) => person.dbId)).toEqual([10, 20]);
    expect(answer[0]?.affiliation[0]).toMatchObject({ dbId: 90 });
    expect(answer[1]?.affiliation[0]).toBe(90);
  });

  it('gives each person their own publications, relationships told apart by id', async () => {
    const answer = (await (await people('example')).json()) as {
      publications?: unknown[];
    }[];
    // Ids made up per record would map Bea's paper as Ann's (one relation
    // object, written once): Bea would show Ann's paper by reference.
    expect(answer.map((person) => person.publications)).toEqual([
      [expect.objectContaining({ dbId: 30 })],
      [expect.objectContaining({ dbId: 40 })],
    ]);
  });

  it('is a 404 naming the name as sent when nobody matches', async () => {
    const response = await people('nobody/exact');
    expect(response.status).toBe(404);
    expect(((await response.json()) as { messages: string[] }).messages).toEqual([
      'No persons found for name: nobody',
    ]);
  });

  it('is a 404 without asking the graph when the name is only spaces', async () => {
    asked.length = 0;
    const response = await people('%20%20');
    expect(response.status).toBe(404);
    expect(((await response.json()) as { messages: string[] }).messages).toEqual([
      'No persons found for name:   ',
    ]);
    expect(asked).toEqual([]);
  });

  it("is Java's 500 for a leading or doubled space", async () => {
    for (const name of ['%20ann', 'ann%20%20example/exact']) {
      const response = await people(name);
      expect(response.status).toBe(500);
      expect(((await response.json()) as { messages: string[] }).messages).toEqual([
        'begin 0, end 1, length 0',
      ]);
    }
  });

  it('takes a trailing slash', async () => {
    expect((await people('example/')).status).toBe(200);
    expect((await people('example/exact/')).status).toBe(200);
  });
});
