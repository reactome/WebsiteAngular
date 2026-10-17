// @vitest-environment node
//
// The Java-against-Java parity harness (spec 010, research R7), against two
// stub servers standing in for the reference (what runs today) and the
// candidate (what replaces it).
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareAll } from './parity.mjs';
import { normalisers } from './normalisers.mjs';

/** A server answering from a table of path -> { status, headers, body }. */
function stub(table) {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    // Live third-party data: a different answer every time.
    if (request.url === '/live') return response.end(`live ${calls}`);
    const answer = table[request.url] ?? { status: 404, body: 'none' };
    response.writeHead(answer.status ?? 200, answer.headers ?? { 'content-type': 'text/plain' });
    response.end(answer.body);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

const json = { 'content-type': 'application/json;charset=UTF-8' };
const reference = {
  '/same': { body: 'abc' },
  '/byte': { body: 'abc' },
  '/status': { status: 200, body: 'x' },
  '/header': {
    headers: { 'content-type': 'text/plain', 'content-disposition': 'a.txt' },
    body: 'x',
  },
  '/token': { headers: json, body: '{"summary":{"token":"T1","type":"X"},"n":1}' },
  '/gz': {
    headers: { 'content-type': 'application/gzip' },
    body: gzipSync('{"summary":{"token":"T1"},"n":1}'),
  },
  '/secret/ABC123': { body: 'x' },
};
const candidate = {
  ...reference,
  '/byte': { body: 'abd' },
  '/status': { status: 500, body: 'x' },
  '/header': {
    headers: { 'content-type': 'text/plain', 'content-disposition': 'b.txt' },
    body: 'x',
  },
  '/token': { headers: json, body: '{"summary":{"token":"T2","type":"X"},"n":1}' },
  '/gz': {
    headers: { 'content-type': 'application/gzip' },
    body: gzipSync('{"summary":{"token":"T9"},"n":1}'),
  },
};

let ref;
let cand;
beforeAll(async () => {
  ref = await stub(reference);
  cand = await stub(candidate);
});
afterAll(async () => {
  await new Promise((resolve) => ref.server.close(resolve));
  await new Promise((resolve) => cand.server.close(resolve));
});

const run = (paths, options = {}) =>
  compareAll(
    paths.map((path) => ({ method: 'GET', path })),
    { reference: ref.url, candidate: cand.url, ...options }
  );

describe('the parity harness', () => {
  it('finds identical answers identical', async () => {
    const report = await run(['/same']);
    expect(report.counts).toEqual({ identical: 1, different: 0 });
  });

  it('finds a one-byte, a status and a header difference', async () => {
    const report = await run(['/byte', '/status', '/header']);
    expect(report.counts).toEqual({ identical: 0, different: 3 });
    expect(report.results.map((r) => r.differs)).toEqual([
      ['body'],
      ['status'],
      ['content-disposition'],
    ]);
  });

  it('removes the analysis token only through a declared normaliser', async () => {
    expect((await run(['/token'])).counts.different).toBe(1);
    expect(
      (await run(['/token'], { normalise: normalisers.analysisResult })).counts.identical
    ).toBe(1);
    expect((await run(['/gz'], { normalise: normalisers.analysisResultGz })).counts.identical).toBe(
      1
    );
  });

  it('never puts a body, and with redaction no path, in its report', async () => {
    const report = await run(['/secret/ABC123'], { redact: true });
    const text = JSON.stringify(report);
    expect(text).not.toContain('ABC123');
    expect(text).not.toContain('"x"');
    expect(report.results[0].request).toBe('#0');
  });

  it('calibrates against the reference itself: a difference counts only where the reference agreed with itself', async () => {
    const report = await run(['/same', '/byte'], { calibrate: true });
    expect(report.results.map((r) => r.calibrated)).toEqual([true, true]);
    expect(report.counts).toEqual({ identical: 1, different: 1 });
    // A reference that disagrees with itself is unstable, counted neither way.
    const live = await run(['/live'], { calibrate: true });
    expect(live.counts).toEqual({ identical: 0, different: 0, unstable: 1 });
    expect(live.results[0].calibrated).toBe(false);
  });
});
