// @vitest-environment node
//
// /citation/download over a database with no DBInfo: Java's
// generalService.getDBInfo() is null, and its getVersion() the
// NullPointerException GlobalExceptionHandler answers. A file of its own,
// because the release, once read, is held for the life of the process.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./graph.ts', async () => ({
  read: async () => [],
  configured: () => true,
  close: async () => {},
  envSetting: (key: string, fallback = '') => process.env[key] || fallback,
}));

let base: string;
let server: Server;

beforeAll(async () => {
  const { app } = await import('./server.ts');
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('/citation/download without a DBInfo', () => {
  it("is Java's 500 for its NullPointerException", async () => {
    const response = await fetch(`${base}/ContentService/citation/download`);
    expect([response.status, ((await response.json()) as { messages: string[] }).messages]).toEqual(
      [500, ['Something unexpected happened and the error has been reported.']]
    );
  });
});
