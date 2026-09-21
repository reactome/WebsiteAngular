// @vitest-environment node
//
// What can be checked without a database.
//
// This service had no handler-level test at all, which is the gap that let a
// `ReferenceError` reach the render service's first request and pass every
// gate. content-node is the one answering beta's traffic, so it had the same
// hole with more at stake.
//
// Most endpoints need Neo4j and belong to `diff.mjs`, which compares them
// against Java. What is checkable here is everything that is *not* a query: the
// endpoint table's own integrity, and the pure functions a declared difference
// is built from.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app, endpoints } from './service.mjs';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('/health', () => {
  it('answers, which nothing checked before', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.endpoints.length).toBe(endpoints.length);
  });

  it('says which code is running, so a stale container can be spotted', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.build).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('the endpoint table', () => {
  it('addresses every endpoint by the path Java calls it', () => {
    // The table is read by the diff harness and by proxy.conf.js, so a path
    // that does not match Java's is a comparison against the wrong thing.
    for (const endpoint of endpoints) {
      expect(endpoint.path, `${endpoint.path} is a ContentService path`).toMatch(
        /^\/ContentService\//
      );
      expect(typeof endpoint.handler, `${endpoint.path} has a handler`).toBe('function');
    }
  });

  it('declares differences as patterns, never as loose strings', () => {
    // `differs` entries are tested with `.test`, so a string here would throw
    // at comparison time rather than at load -- during a diff run, which is
    // exactly when the harness needs to be trustworthy.
    for (const endpoint of endpoints) {
      for (const rule of endpoint.differs ?? []) {
        expect(rule, `${endpoint.path} declares a RegExp`).toBeInstanceOf(RegExp);
      }
    }
  });

  it('gives every unordered endpoint a key, and every normalise a function', () => {
    for (const endpoint of endpoints) {
      if ('unordered' in endpoint) expect(typeof endpoint.unordered).toBe('function');
      if ('normalise' in endpoint) expect(typeof endpoint.normalise).toBe('function');
    }
  });
});

describe("the person lists' declared difference", () => {
  const person = endpoints.find((e) => e.path.endsWith('/authoredReactions'));

  it('keeps the first occurrence and drops later ones', () => {
    // Java returns an event once per authorship edit. The page asks what a
    // person authored, not when they edited it, so the event belongs once --
    // and first-occurrence in Java's descending order means the row that stays
    // is the one that was already there, in the position it was already in.
    const java = [
      { dbId: 1, dateTime: '2026-01-01' },
      { dbId: 2, dateTime: '2025-01-01' },
      { dbId: 1, dateTime: '2013-01-01' },
      { dbId: 3, dateTime: '2012-01-01' },
    ];
    expect(person.normalise(java)).toEqual([
      { dbId: 1, dateTime: '2026-01-01' },
      { dbId: 2, dateTime: '2025-01-01' },
      { dbId: 3, dateTime: '2012-01-01' },
    ]);
  });

  it('leaves a list with no duplicates exactly as it was', () => {
    const java = [{ dbId: 1 }, { dbId: 2 }, { dbId: 3 }];
    expect(person.normalise(java)).toEqual(java);
  });

  it('is declared, so the harness reports it rather than hiding it', () => {
    expect(person.differs?.length, 'the normalisation is declared').toBeGreaterThan(0);
  });
});
