// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Description } from '../api-types/schema.ts';
import { checkRoutes, routes } from './endpoints.ts';

// A host answering a handful of routes, some rightly and some not, so the
// check is seen to tell them apart (constitution III).
const ANSWERS: Record<string, [number, string, string]> = {
  '/ContentService/x/good': [200, 'application/json', '{"a":"text"}'],
  '/ContentService/x/wrong': [200, 'application/json', '{"a":1}'],
  '/ContentService/x/broken': [200, 'application/json', '{"a":'],
  '/ContentService/x/name': [200, 'text/plain', 'reactome'],
  '/ContentService/x/empty': [200, 'text/plain', ''],
  '/ContentService/x/missing': [404, 'application/json', '{}'],
  '/ContentService/x/undescribed': [200, 'application/json', '{"b":2}'],
};

function host(answers: Record<string, [number, string, string]>): Promise<[Server, string]> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const [status, type, body] = answers[(req.url ?? '').split('?')[0] ?? ''] ?? [
        500,
        'text/plain',
        'no',
      ];
      res.writeHead(status, { 'Content-Type': type }).end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve([
        server,
        `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
      ]);
    });
  });
}

const schema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
const json = { responses: { '200': { content: { 'application/json': { schema } } } } };
const DESCRIPTION: Description = {
  paths: {
    '/ContentService/x/good': { get: json },
    '/ContentService/x/wrong': { get: json },
    '/ContentService/x/broken': { get: json },
  },
  components: { schemas: { Long: { type: 'integer', format: 'int64' } } },
};

describe('the release check', () => {
  let one: Server;
  let other: Server;
  let base = '';
  let compare = '';

  beforeAll(async () => {
    [one, base] = await host(ANSWERS);
    [other, compare] = await host({
      ...ANSWERS,
      '/ContentService/x/name': [200, 'text/plain', 'other'],
    });
  });
  afterAll(() => {
    one.close();
    other.close();
  });

  const failing = async (paths: string[], against?: string) =>
    (await checkRoutes(base, paths, DESCRIPTION, against))
      .filter((o) => o.problems.length)
      .map((o) => o.path);

  it('passes an answer as the description says, and text as text', async () => {
    expect(await failing(['/x/good', '/x/name'])).toEqual([]);
  });

  it('fails an answer of the wrong shape, one that is not JSON, an empty one, and a 404', async () => {
    expect(await failing(['/x/wrong', '/x/broken', '/x/empty', '/x/missing'])).toEqual([
      '/x/wrong',
      '/x/broken',
      '/x/empty',
      '/x/missing',
    ]);
  });

  it('says which answers it checked the shape of: only those the description has one for', async () => {
    // A route the description has no schema for passes on 200 and JSON alone;
    // counted as "as described", it overstated what was checked.
    const outcomes = await checkRoutes(base, ['/x/good', '/x/undescribed', '/x/name'], DESCRIPTION);
    expect(outcomes.map((o) => [o.path, o.problems.length, o.shaped])).toEqual([
      ['/x/good', 0, true],
      ['/x/undescribed', 0, false],
      ['/x/name', 0, false],
    ]);
  });

  it('fails an answer another host serving the same release gives differently', async () => {
    expect(await failing(['/x/good', '/x/name'], compare)).toEqual(['/x/name']);
  });

  it('asks at least 30 routes, and none of a person', () => {
    const asked = routes({
      pathway: 'R-HSA-1',
      subpathway: 'R-HSA-2',
      reaction: 'R-HSA-3',
      entity: 'R-HSA-4',
      complex: 'R-HSA-5',
      accession: 'P00000',
    });
    expect(asked.length).toBeGreaterThanOrEqual(30);
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked.filter((p) => /\/(person|people)\b/.test(p))).toEqual([]);
  });
});
