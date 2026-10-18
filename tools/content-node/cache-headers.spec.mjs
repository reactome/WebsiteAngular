// @vitest-environment node
//
// The labels as the service writes them (spec 011): every answer under
// /ContentService carries a Cache-Control and an X-Cache-Rule, and only a
// standard-form GET or HEAD answered 200 is public. The class attributes
// are answered from a snapshot, so these need no graph; the graph stand-in
// answers nothing, for the endpoints that would ask it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./graph.mjs', () => ({
  read: async () => [],
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./service.mjs');
const { CACHEABLE } = await import('./cache-label.mjs');

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
