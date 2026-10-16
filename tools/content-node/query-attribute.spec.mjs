// @vitest-environment node
//
// /data/query/{id}/stId and /normalPathway matched in any case, as Java's
// /query/{id}/{attributeName} finds its getter, with a graph stand-in so the
// handler that answers, and its message, can be seen. Java's messages
// measured 16 Oct 2026.
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

vi.mock('./graph.mjs', () => ({
  // 48887 has no stable id; R-HSA-70486 has one. Neither has a normal
  // pathway, so only the stId handler can answer 200.
  read: async (cypher, params) => [
    {
      stId: JSON.stringify(params).includes('48887') ? null : 'R-HSA-70486',
      schemaClass: 'Reaction',
      labels: ['Reaction'],
      dbId: cypher.includes('normalPathway') ? null : 70486,
    },
  ],
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

describe('stId in any case is the stable id', () => {
  for (const path of ['R-HSA-70486/STID', 'R-HSA-70486/ST%49D;x', 'R-HSA-70486/stid/'])
    it(path, async () => {
      const response = await fetch(`${base}/ContentService/data/query/${path}`);
      expect([response.status, await response.text()]).toEqual([200, 'R-HSA-70486']);
    });
});

describe('the attribute, in any case, reaches its own handler and is echoed as sent', () => {
  for (const [path, attribute] of [
    ['48887/STID', 'STID'],
    ['48887/ST%49D;x', 'STID'],
    ['48887/stid/', 'stid'],
    ['R-HSA-70486/nORMALP%41THWAY;a=b/', 'nORMALPATHWAY'],
    ['R-HSA-70486/normalPathway', 'normalPathway'],
  ])
    it(path, async () => {
      const response = await fetch(`${base}/ContentService/data/query/${path}`);
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body.messages[0]).toMatch(
        new RegExp(`^Attribute: '${attribute}' has not been found for object: `)
      );
    });
});
