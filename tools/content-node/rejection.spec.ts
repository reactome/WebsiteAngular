// @vitest-environment node
//
// A handler's promise that rejects past the endpoint's own failure handling
// (spec 014 T028). Express 4 did not wait on a handler's promise, so the
// handlers were wrapped in `void (async () => …)()`, and a rejection that
// escaped them was unhandled: no answer at all, the request left open. Express
// 5 forwards it to the error handler, which answers with the service's 500 in
// Java's envelope. A handler that throws `null` is one such: answering it reads
// the failure's message, and that throws in turn.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './server.ts';
import { endpoints } from './registry.ts';
import type { Endpoint } from './endpoint.ts';

const PATH = '/ContentService/data/rejection-test/{id}';
const rejecting: Endpoint = {
  path: PATH,
  handler: async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- a failure that is no Error is the case
    throw null;
  },
};

let base = '';
let server: ReturnType<ReturnType<typeof app>['listen']>;
const unhandled: unknown[] = [];
const record = (reason: unknown) => unhandled.push(reason);

beforeAll(async () => {
  process.on('unhandledRejection', record);
  endpoints.push(rejecting);
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  endpoints.splice(endpoints.indexOf(rejecting), 1);
  process.off('unhandledRejection', record);
  await new Promise((resolve) => server.close(resolve));
});

describe('a handler whose promise rejects', () => {
  it('is answered with the service’s 500, and nothing is left unhandled', async () => {
    const response = await fetch(`${base}/ContentService/data/rejection-test/R-HSA-69620`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as { reason: string; messages: string[] };
    expect([response.status, body.reason, body.messages]).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['Something unexpected happened and the error has been reported.'],
    ]);
    // An unhandled rejection is reported on a later turn of the event loop.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  });

  it('is answered the same where the path cannot be decoded (the URIError path)', async () => {
    const response = await fetch(`${base}/ContentService/data/rejection-test/%FF`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as { reason: string };
    expect([response.status, body.reason]).toEqual([500, 'INTERNAL_SERVER_ERROR']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).toEqual([]);
  });
});
