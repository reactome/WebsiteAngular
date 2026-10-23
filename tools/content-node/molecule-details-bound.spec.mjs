// @vitest-environment node
//
// POST /interactors/static/molecules/details runs one query per accession, one
// at a time, and a 10MB body holds hundreds of thousands: its batches have a
// share of their own, and stop when the client is gone. A stand-in graph
// holds every query open until the test lets it go.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';

const held = [];
let asked = 0;
vi.mock('./graph.ts', () => ({
  read: () => {
    asked += 1;
    return new Promise((resolve) => held.push(() => resolve([])));
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./server.ts');

let server;
let port;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

/** A POST of these accessions: its response, and a way to drop the connection. */
function post(accessions) {
  const sent = httpRequest({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/ContentService/interactors/static/molecules/details',
    headers: { 'Content-Type': 'text/plain' },
  });
  const answered = new Promise((resolve, reject) => {
    sent.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, response, body }));
    });
    sent.on('error', reject);
  });
  sent.end(accessions.join(','));
  return { answered, drop: () => sent.destroy() };
}

const until = async (condition) => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(condition()).toBe(true);
};
const release = () => {
  for (const go of held.splice(0)) go();
};

describe('the molecule details batch', () => {
  it('runs at most four at once; a fifth is the 503 to try again shortly', async () => {
    const running = [1, 2, 3, 4].map((n) => post([`P0000${n}`]));
    await until(() => held.length === 4);
    const fifth = await post(['P00005']).answered;
    expect(fifth.status).toBe(503);
    expect(fifth.response.headers['retry-after']).toBe('5');
    expect(JSON.parse(fifth.body).messages).toEqual(['The service is busy; try again shortly']);
    release();
    // None found for any is Java's 404, and each batch gives its place back.
    for (const { answered } of running) expect((await answered).status).toBe(404);
    const after = post(['P00006']);
    await until(() => held.length === 1);
    release();
    expect((await after.answered).status).toBe(404);
  });

  it('stops asking once the client is gone', async () => {
    asked = 0;
    const { answered, drop } = post(['P1', 'P2', 'P3', 'P4', 'P5']);
    answered.catch(() => {});
    await until(() => held.length === 1);
    drop();
    // The close is seen before the first lookup returns; no second one starts.
    await new Promise((r) => setTimeout(r, 50));
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toBe(1);
    // Its place is given back.
    const next = post(['P6']);
    await until(() => held.length === 1);
    release();
    expect((await next.answered).status).toBe(404);
  });
});
