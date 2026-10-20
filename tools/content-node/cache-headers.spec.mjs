// @vitest-environment node
//
// The labels as the service writes them (spec 011): every answer under
// /ContentService carries a Cache-Control and an X-Cache-Rule, and only a
// standard-form GET or HEAD answered 200 is public. The class attributes
// are answered from a snapshot, so these need no graph; the graph stand-in
// answers nothing, for the endpoints that would ask it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./graph.ts', () => ({
  read: async () => [],
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./service.ts');
const { CACHEABLE } = await import('./cache-label.ts');

let base;
let server;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const headers = (response) => [
  response.headers.get('cache-control'),
  response.headers.get('x-cache-rule'),
];
const at = (path, init) => fetch(`${base}/ContentService${path}`, init);
const raw = async (path, method = 'GET', requestHeaders = {}) => {
  const { request } = await import('node:http');
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const call = request(
      { host: url.hostname, port: url.port, path, method, headers: requestHeaders },
      (response) => {
        response.resume();
        resolve([
          response.statusCode,
          response.headers['cache-control'],
          response.headers['x-cache-rule'],
        ]);
      }
    );
    call.on('error', reject);
    call.end();
  });
};

describe('the labels the service writes', () => {
  it('makes a standard GET public, a HEAD too, and changes nothing else about it', async () => {
    const plain = await at('/data/schema/Pathway/attributes');
    const body = await plain.text();
    expect([plain.status, ...headers(plain)]).toEqual([200, CACHEABLE, 'standard']);
    const head = await at('/data/schema/Pathway/attributes', { method: 'HEAD' });
    expect([head.status, ...headers(head)]).toEqual([200, CACHEABLE, 'standard']);
    const extra = await at('/data/schema/Pathway/attributes?utm_source=x');
    expect([extra.status, ...headers(extra)]).toEqual([200, 'no-store', 'parameter:utm_source']);
    expect(await extra.text()).toBe(body);
  });

  it('keeps the label on the 304 that stands for a standard 200', async () => {
    const first = await at('/data/schema/Pathway/attributes');
    await first.arrayBuffer();
    // Over plain HTTP: fetch adds `Cache-Control: no-cache` to a
    // conditional request, after which Express never answers 304.
    const again = await raw('/ContentService/data/schema/Pathway/attributes', 'GET', {
      'If-None-Match': first.headers.get('etag'),
    });
    expect(again).toEqual([304, CACHEABLE, 'standard']);
  });

  it('does not store a 200 for a name not in standard form, nor an error', async () => {
    const closure = await at('/data/schema/Pathway$AjcClosure5/referrals');
    expect([closure.status, ...headers(closure)]).toEqual([200, 'no-store', 'path:id']);
    // Routing decodes the letter, so it is answered; as sent, it is a
    // second spelling of Pathway.
    const encoded = await at('/data/schema/P%61thway/attributes');
    expect([encoded.status, ...headers(encoded)]).toEqual([200, 'no-store', 'path:id']);
    const wrongCase = await at('/data/schema/pathway/attributes');
    expect([wrongCase.status, ...headers(wrongCase)]).toEqual([500, 'no-store', 'status']);
    const missing = await at('/data/query/R-HSA-0000001');
    expect([missing.status, ...headers(missing)]).toEqual([404, 'no-store', 'status']);
  });

  it('does not store a POST, an OPTIONS, or what never reached an endpoint', async () => {
    const post = await at('/data/query/ids', { method: 'POST', body: 'R-HSA-1' });
    expect([post.status >= 200, ...headers(post)]).toEqual([true, 'no-store', 'method']);
    const options = await at('/data/schema/Pathway/attributes', { method: 'OPTIONS' });
    expect([options.status, ...headers(options)]).toEqual([200, 'no-store', 'default']);
    expect(await raw('/ContentService/data/query/R-HSA-1%2fx')).toEqual([
      400,
      'no-store',
      'default',
    ]);
    expect(await raw('/ContentService/data//query/R-HSA-1')).toEqual([404, 'no-store', 'default']);
    expect(await raw('/ContentService/data;x/diseases')).toEqual([404, 'no-store', 'default']);
    expect(await raw('/ContentService/data/nothing')).toEqual([404, 'no-store', 'default']);
  });

  it('keeps anything carrying a token private, however standard the rest', async () => {
    const token = await at('/data/schema/Pathway/attributes?token=abc');
    expect([token.status, ...headers(token)]).toEqual([200, 'private, no-store', 'token']);
    expect(await raw('/ContentService/data//x?token=1')).toEqual([
      404,
      'private, no-store',
      'token',
    ]);
  });
});

describe('an answer that fails as it is written', () => {
  it('is relabelled with the 500 it becomes, not left public', async () => {
    // A body JSON cannot write (a BigInt), after the label is on: the 500
    // that follows must not go out as the 200's public answer would have.
    const express = (await import('express')).default;
    const { answer } = await import('./service.ts');
    const endpoint = {
      path: '/ContentService/data/schema/{id}/attributes',
      handler: async () => ({ status: 200, body: { size: 1n } }),
    };
    const lone = express();
    lone.get('/ContentService/data/schema/Pathway/attributes', (request, response) =>
      answer(endpoint, request, response)
    );
    const server = await new Promise((resolve) => {
      const listening = lone.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/ContentService/data/schema/Pathway/attributes`
      );
      expect([response.status, ...headers(response)]).toEqual([500, 'no-store', 'status']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

// One URL per answer (spec 011 FR-013): a trailing slash is the same answer
// under a second URL, so a GET or HEAD for it is sent to the URL without.
// The redirect is never stored: standard form cannot tell whether the URL it
// points to exists, so a stored redirect would be one entry per id asked.
describe('a trailing slash', () => {
  it('is a 301 to the URL without it, query kept as sent, and never stored', async () => {
    expect(await redirect('/ContentService/data/schema/Pathway/attributes/?view=nested')).toEqual([
      301,
      '/ContentService/data/schema/Pathway/attributes?view=nested',
      'no-store',
      'redirect',
    ]);
    expect(await redirect('/ContentService/data/schema/Pathway/attributes/', 'HEAD')).toEqual([
      301,
      '/ContentService/data/schema/Pathway/attributes',
      'no-store',
      'redirect',
    ]);
    // An id of the right shape that nothing has: still not a stored entry.
    expect(await redirect('/ContentService/data/query/R-HSA-98765432123456/')).toEqual([
      301,
      '/ContentService/data/query/R-HSA-98765432123456',
      'no-store',
      'redirect',
    ]);
  });

  it('keeps the path and query exactly as sent, and a token private', async () => {
    expect(await redirect('/ContentService/data/query/R-HSA-1%2Dx/')).toEqual([
      301,
      '/ContentService/data/query/R-HSA-1%2Dx',
      'no-store',
      'redirect',
    ]);
    // Routed as /data/query/...: redirected, the letter left as it came.
    expect(await redirect('/ContentService/data/qu%65ry/R-HSA-1/')).toEqual([
      301,
      '/ContentService/data/qu%65ry/R-HSA-1',
      'no-store',
      'redirect',
    ]);
    expect(await redirect('/ContentService/data/schema/Pathway/attributes/?a=1?b=2')).toEqual([
      301,
      '/ContentService/data/schema/Pathway/attributes?a=1?b=2',
      'no-store',
      'redirect',
    ]);
    expect(await redirect('/ContentService/data/schema/Pathway/attributes/?token=x')).toEqual([
      301,
      '/ContentService/data/schema/Pathway/attributes?token=x',
      'private, no-store',
      'token',
    ]);
  });

  it('is not a redirect for a POST, a POST-only path, a path no endpoint answers, or a malformed escape', async () => {
    const post = await at('/data/query/ids/', { method: 'POST', body: 'R-HSA-1' });
    expect([post.status === 301, ...headers(post)]).toEqual([false, 'no-store', 'method']);
    const postOnly = await redirect('/ContentService/data/orthologies/ids/species/9606/');
    expect(postOnly.slice(0, 2)).toEqual([405, undefined]);
    expect(await redirect('/ContentService/data/nothing/')).toEqual([
      404,
      undefined,
      'no-store',
      'default',
    ]);
    const malformed = await redirect('/ContentService/data/query/%zz/');
    expect([malformed[0] === 301, malformed[2]]).toEqual([false, 'no-store']);
  });
});

async function redirect(path, method = 'GET') {
  const { request } = await import('node:http');
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const call = request({ host: url.hostname, port: url.port, path, method }, (response) => {
      response.resume();
      resolve([
        response.statusCode,
        response.headers.location,
        response.headers['cache-control'],
        response.headers['x-cache-rule'],
      ]);
    });
    call.on('error', reject);
    call.end();
  });
}
