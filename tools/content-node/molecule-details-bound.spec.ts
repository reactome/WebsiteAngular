// @vitest-environment node
//
// POST /interactors/static/molecules/details runs one query per accession, one
// at a time, and a 10MB body holds hundreds of thousands: its batches have a
// share of their own, and stop when the client is gone. A stand-in graph
// holds every query open until the test lets it go.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The open queries, each a function that lets its query answer. */
const held: (() => void)[] = [];
let asked = 0;
vi.mock('./graph.ts', () => ({
  read: () => {
    asked += 1;
    return new Promise<unknown[]>((resolve) => held.push(() => resolve([])));
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./server.ts');

let server: Server;
let port: number;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** An answer as it came: status, the response for its headers, and the body. */
type Answer = { status: number | undefined; response: IncomingMessage; body: string };

/** A POST of these accessions: its response, and a way to drop the connection. */
function post(accessions: string[]) {
  const sent = httpRequest({
    host: '127.0.0.1',
    port,
    // A connection of its own, closed with its answer: the server's count of
    // open connections then says when a dropped one has gone.
    agent: false,
    method: 'POST',
    path: '/ContentService/interactors/static/molecules/details',
    headers: { 'Content-Type': 'text/plain' },
  });
  const answered = new Promise<Answer>((resolve, reject) => {
    sent.on('response', (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', () => resolve({ status: response.statusCode, response, body }));
    });
    sent.on('error', reject);
  });
  sent.end(accessions.join(','));
  return { answered, drop: () => sent.destroy() };
}

const until = async (condition: () => boolean) => {
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
    expect((JSON.parse(fifth.body) as { messages: string[] }).messages).toEqual([
      'The service is busy; try again shortly',
    ]);
    release();
    // None found for any is Java's 404, and each batch gives its place back.
    for (const { answered } of running) expect((await answered).status).toBe(404);
    const after = post(['P00006']);
    await until(() => held.length === 1);
    release();
    expect((await after.answered).status).toBe(404);
  });

  it('stops asking once the client is gone, and gives its place back', async () => {
    asked = 0;
    const { answered, drop } = post(['P1', 'P2', 'P3', 'P4', 'P5']);
    answered.catch(() => {});
    await until(() => held.length === 1);
    drop();
    // The server has seen the close before the first lookup returns.
    const open = () =>
      new Promise<number>((resolve) =>
        server.getConnections((_error: Error | null, count: number) => resolve(count))
      );
    let connections = 1;
    for (let i = 0; i < 200 && connections > 0; i += 1) {
      connections = await open();
      if (connections > 0) await new Promise((r) => setTimeout(r, 10));
    }
    expect(connections).toBe(0);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toBe(1);
    // All four places are free again: four run, and a fifth is refused. A
    // dropped batch that kept its place would leave three.
    const four = [1, 2, 3, 4].map((n) => post([`Q0000${n}`]));
    await until(() => held.length === 4);
    expect((await post(['Q00005']).answered).status).toBe(503);
    release();
    for (const { answered: each } of four) expect((await each).status).toBe(404);
  });
});
