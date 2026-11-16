// @vitest-environment node
//
// /ContentService/openapi.json (spec 016, T028): the API description the
// site's API page reads, published as generated. No graph is asked.
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const COMMITTED = readFileSync(
  new URL('../../projects/contract/openapi.json', import.meta.url),
  'utf8'
);

let server: Server;
let base: string;

beforeAll(async () => {
  const { app } = await import('./server.ts');
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('/ContentService/openapi.json', () => {
  it('is the committed description, as JSON', async () => {
    const response = await fetch(`${base}/ContentService/openapi.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/);
    expect(await response.text()).toBe(COMMITTED);
  });

  it('takes a trailing slash, as every route of the service does', async () => {
    const response = await fetch(`${base}/ContentService/openapi.json/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(COMMITTED);
  });

  it('is never stored: it changes with a deployment, and the edge is purged only at a release', async () => {
    const response = await fetch(`${base}/ContentService/openapi.json`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
