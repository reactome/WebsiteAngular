// @vitest-environment node
//
// /exporter/reaction/{identifier}/diagram (spec 006 T092, research D22 step
// 5): the id read as graph-core's findById reads it, and Java's answers when
// it is not a reaction, not there, or the layout fails. The graph and the
// layout are stand-ins; every error body below is Java's, measured against
// the deployed service on 6 Nov 2026, with this server's address for Java's.
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHEABLE } from './cache-label.ts';

/** The objects the stand-in graph holds, by how resolveId asks for them. */
const OBJECTS: Record<string, { labels: string[]; stId: string }> = {
  'R-HSA-6805479': {
    labels: ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'Reaction'],
    stId: 'R-HSA-6805479',
  },
  '6805479': {
    labels: ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'Reaction'],
    stId: 'R-HSA-6805479',
  },
  'R-HSA-109581': { labels: ['DatabaseObject', 'Event', 'Pathway'], stId: 'R-HSA-109581' },
  '109581': { labels: ['DatabaseObject', 'Event', 'Pathway'], stId: 'R-HSA-109581' },
  REACT_1: {
    labels: ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'BlackBoxEvent'],
    stId: 'R-HSA-163796',
  },
};
const asked: { cypher: string; id: unknown }[] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: { id?: string } = {}) => {
    asked.push({ cypher, id: params.id });
    const found = params.id === undefined ? undefined : OBJECTS[params.id];
    return found ? [found] : [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

/** What the stand-in layout does next: answer, or throw. */
let layout: (stId: string, first?: number) => unknown;
const laidOut: { stId: string; first: number | undefined }[] = [];
vi.mock('./reaction-layout/answer.ts', () => ({
  reactionAnswer: async (stId: string, first?: number) => {
    laidOut.push({ stId, first });
    return layout(stId, first);
  },
}));

const { app } = await import('./server.ts');
const { JavaNullPointerException, JavaRuntimeException } =
  await import('./reaction-layout/model.ts');

const LAYOUT = '{"diagram":{"isDisease":false,"displayName":"A reaction"},"graph":{"dbId":1}}';

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
  laidOut.length = 0;
  layout = () => ({
    answer: { status: 200, type: 'application/json', serialised: LAYOUT },
  });
});

/**
 * A GET of the path exactly as written: fetch would resolve `.` and `%2E`
 * as dot segments, as a browser does, and never send them.
 */
function get(path: string) {
  return new Promise<{
    status: number;
    type: string;
    cache: string;
    location: string;
    body: string;
  }>((resolve, reject) => {
    const sent = httpRequest(`${base}${path}`, { path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          type: String(response.headers['content-type'] ?? ''),
          cache: String(response.headers['cache-control'] ?? ''),
          location: String(response.headers['location'] ?? ''),
          body,
        })
      );
    });
    sent.on('error', reject);
    sent.end();
  });
}

const PATH = (id: string) => `/ContentService/exporter/reaction/${id}/diagram`;

/** Java's error envelope for this path, as its GlobalExceptionHandler writes it. */
const javaError = (id: string, code: number, reason: string, message: string | null) =>
  `{"code":${code},"reason":"${reason}","url":"${base}${PATH(id)}","messages":[${
    message === null ? 'null' : JSON.stringify(message)
  }],"targets":null}`;

describe('/exporter/reaction/{identifier}/diagram', () => {
  it("answers a reaction's layout from glyph id 1, as the library writes it, stored at the edge", async () => {
    const answer = await get(PATH('R-HSA-6805479'));
    expect(answer).toMatchObject({ status: 200, body: LAYOUT, cache: CACHEABLE });
    expect(answer.type).toMatch(/^application\/json/);
    // The service's start, the library's default (D22).
    expect(laidOut).toEqual([{ stId: 'R-HSA-6805479', first: undefined }]);
  });

  it('finds a reaction by dbId, by a versioned or padded stable id, or by its pre-2016 id', async () => {
    for (const [id, looked, stId] of [
      ['6805479', '6805479', 'R-HSA-6805479'],
      ['R-HSA-6805479.3', 'R-HSA-6805479', 'R-HSA-6805479'],
      ['R-HSA-6805479.x', 'R-HSA-6805479', 'R-HSA-6805479'],
      ['%20R-HSA-6805479', 'R-HSA-6805479', 'R-HSA-6805479'],
      ['REACT_1', 'REACT_1', 'R-HSA-163796'],
    ]) {
      asked.length = 0;
      laidOut.length = 0;
      const answer = await get(PATH(id as string));
      expect([id, answer.status, answer.body]).toEqual([id, 200, LAYOUT]);
      expect([id, asked.map((a) => a.id)]).toEqual([id, [looked]]);
      // Laid out by the stable id it found, whatever the id asked by.
      expect([id, laidOut.map((l) => l.stId)]).toEqual([id, [stId]]);
    }
    // Stored in the spellings every graph answer is (an `oid`), not padded,
    // nor with a view Java declares and never reads.
    expect((await get(PATH('6805479'))).cache).toBe(CACHEABLE);
    expect((await get(PATH('%20R-HSA-6805479'))).cache).toBe('no-store');
    expect((await get(`${PATH('R-HSA-6805479')}?view=nested`)).cache).toBe('no-store');
  });

  it("is Java's 400 for an object that is not a ReactionLikeEvent, named as sent", async () => {
    for (const id of ['R-HSA-109581', '109581', 'R-HSA-109581.2']) {
      const answer = await get(PATH(id));
      expect([id, answer.status, answer.body, answer.cache]).toEqual([
        id,
        400,
        javaError(
          id,
          400,
          'BAD_REQUEST',
          `The identifier '${id}' does not correspond to a 'ReactionLikeEvent'`
        ),
        'no-store',
      ]);
    }
    expect(laidOut).toEqual([]);
  });

  it("is Java's 404 for an id that finds nothing, the id decoded but not trimmed", async () => {
    for (const [id, named] of [
      ['R-HSA-0', 'R-HSA-0'],
      ['foo', 'foo'],
      ['r-hsa-6805479', 'r-hsa-6805479'],
      ['UniProt:P04637', 'UniProt:P04637'],
      ['0', '0'],
      ['-1', '-1'],
      ['1e3', '1e3'],
      ['%20', ' '],
      ['R-HSA-6805479%3B', 'R-HSA-6805479;'],
    ]) {
      const answer = await get(PATH(id as string));
      expect([id, answer.status, answer.body]).toEqual([
        id,
        404,
        javaError(id as string, 404, 'NOT_FOUND', `Identifier '${named}' not found`),
      ]);
    }
    expect(laidOut).toEqual([]);
  });

  it("is Java's 500 for an id of dots and for a dbId past a long, before asking the graph", async () => {
    for (const [id, message] of [
      ['.', 'Index 0 out of bounds for length 0'],
      ['...', 'Index 0 out of bounds for length 0'],
      ['%2E', 'Index 0 out of bounds for length 0'],
      ['99999999999999999999', 'For input string: "99999999999999999999"'],
    ]) {
      asked.length = 0;
      const answer = await get(PATH(id as string));
      expect([id, answer.status, answer.body]).toEqual([
        id,
        500,
        javaError(id as string, 500, 'INTERNAL_SERVER_ERROR', message as string),
      ]);
      expect(asked).toEqual([]);
    }
  });

  it("answers the library's Java exceptions as Java's handler does", async () => {
    const cases: [Error, string | null][] = [
      // handleNullPointerException: its fixed text.
      [
        new JavaNullPointerException(),
        'Something unexpected happened and the error has been reported.',
      ],
      // handleUnclassified: the message, and null written as null.
      [
        new JavaRuntimeException('No Schema class defined for [1:an entity]'),
        'No Schema class defined for [1:an entity]',
      ],
      [
        new JavaRuntimeException('Index 0 out of bounds for length 0'),
        'Index 0 out of bounds for length 0',
      ],
      [new JavaRuntimeException(null), null],
    ];
    for (const [failure, message] of cases) {
      layout = () => {
        throw failure;
      };
      const answer = await get(PATH('R-HSA-6805479'));
      expect([message, answer.status, answer.body, answer.cache]).toEqual([
        message,
        500,
        javaError('R-HSA-6805479', 500, 'INTERNAL_SERVER_ERROR', message),
        'no-store',
      ]);
      expect(answer.type).toMatch(/^application\/json/);
    }
  });

  it("leaves any other failure to the service's own 500, not dressed as Java's", async () => {
    layout = () => {
      throw new TypeError('a bug of ours');
    };
    const answer = await get(PATH('R-HSA-6805479'));
    expect([answer.status, answer.body]).toEqual([500, 'content service error']);
  });

  it('sends the slashed URL to the unslashed one, as for every endpoint', async () => {
    const answer = await get(`${PATH('R-HSA-6805479')}/`);
    expect([answer.status, answer.location]).toEqual([301, PATH('R-HSA-6805479')]);
  });

  it("is not the reaction's image: /exporter/reaction/{identifier}.{ext} is no route of node's", async () => {
    const answer = await get('/ContentService/exporter/reaction/R-HSA-6805479.png');
    expect(answer.status).toBe(404);
    expect(laidOut).toEqual([]);
  });
});
