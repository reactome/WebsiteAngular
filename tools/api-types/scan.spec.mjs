// @vitest-environment node
//
// The scan finds a content API call however its URL reaches it in the file.
import path from 'node:path';
import { expect, it } from 'vitest';
import { scanCalls } from './scan.mjs';

it('follows a URL set in the constructor, and leaves other calls alone', () => {
  const calls = scanCalls(path.join(import.meta.dirname, 'fixtures', 'scan'));
  expect(calls.map((c) => [c.method, c.http, c.readAs])).toEqual([['species', 'GET', 'string[]']]);
});
