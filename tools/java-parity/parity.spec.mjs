// @vitest-environment node
//
// The Java-against-Java parity harness (spec 010, research R7), against two
// stub servers standing in for the reference (what runs today) and the
// candidate (what replaces it).
import { createServer } from 'node:http';
import { setInterval, clearInterval } from 'node:timers';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareAll, verdict } from './parity.mjs';
import { normalisers } from './normalisers.mjs';

/** A server answering from a table of path -> { status, headers, body }. */
function stub(table) {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    // Live third-party data: a different answer every time.
    if (request.url === '/live') return response.end(`live ${calls}`);
    // An answer built from the Host it was asked with.
    if (request.url === '/host') return response.end(`host ${request.headers.host}`);
    // A server that never answers.
    if (request.url === '/hang') return;
    // One that never stops answering, a byte at a time.
    if (request.url === '/trickle') {
      const timer = setInterval(() => response.write('.'), 50);
      response.on('close', () => clearInterval(timer));
      return;
    }
    // Two Content-Types, which a parsed header map shows as one.
    if (request.url === '/twice' && !table.name) {
      response.setHeader('content-type', ['text/plain', 'text/html']);
      return response.end('x');
    }
    // Context-path aware: only /ctx/x exists.
    if (request.url === '/ctx/x') return response.end(`ctx ${table.name ?? ''}`);
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
  '/redirect': { status: 302, headers: { location: '/a' }, body: '' },
  '/vary': { headers: { 'content-type': 'text/plain', vary: 'Accept' }, body: 'x' },
  '/token': {
    headers: json,
    body: '{"summary":{"token":"T1","type":"X"},"n":9007199254740993}',
  },
  '/gz': {
    headers: { 'content-type': 'application/gzip' },
    body: gzipSync('{"summary":{"token":"T1"},"n":1}'),
  },
  '/text404': { status: 404, body: 'secret-body-text' },
  '/secret/ABC123': { body: 'x' },
};
const candidate = {
  ...reference,
  name: 'candidate',
  '/twice': { headers: { 'content-type': 'text/plain' }, body: 'x' },
  '/byte': { body: 'abd' },
  '/status': { status: 500, body: 'x' },
  '/header': {
    headers: { 'content-type': 'text/plain', 'content-disposition': 'b.txt' },
    body: 'x',
  },
  '/redirect': { status: 302, headers: { location: '/b' }, body: '' },
  '/vary': { headers: { 'content-type': 'text/plain' }, body: 'x' },
  '/token': {
    headers: json,
    body: '{"summary":{"token":"T2","type":"X"},"n":9007199254740993}',
  },
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
  ref.server.closeAllConnections();
  cand.server.closeAllConnections();
  await new Promise((resolve) => ref.server.close(resolve));
  await new Promise((resolve) => cand.server.close(resolve));
});

const run = (paths, options = {}) =>
  compareAll(
    paths.map((path) => (typeof path === 'string' ? { method: 'GET', path } : path)),
    { reference: ref.url, candidate: cand.url, ...options }
  );

describe('the parity harness', () => {
  it('finds identical answers identical', async () => {
    const report = await run(['/same']);
    expect(report.counts).toEqual({ identical: 1, different: 0 });
    expect(verdict(report)).toBe(0);
  });

  it('finds a one-byte, a status and a header difference', async () => {
    const report = await run(['/byte', '/status', '/header']);
    expect(report.counts).toEqual({ identical: 0, different: 3 });
    expect(report.results.map((r) => r.differs)).toEqual([
      ['body'],
      ['status'],
      ['content-disposition'],
    ]);
    expect(verdict(report)).toBe(1);
  });

  it('compares every header but named noise: a redirect target, a Vary', async () => {
    const report = await run(['/redirect', '/vary']);
    expect(report.results.map((r) => r.differs)).toEqual([['location'], ['vary']]);
  });

  it('asks both sides with the same Host', async () => {
    const report = await run([{ method: 'GET', path: '/host' }], { host: 'reactome.example' });
    expect(report.counts.identical).toBe(1);
  });

  it('removes the analysis token only through a declared normaliser, leaving every other byte', async () => {
    expect((await run(['/token'])).counts.different).toBe(1);
    expect(
      (await run(['/token'], { normalise: normalisers.analysisResult })).counts.identical
    ).toBe(1);
    expect((await run(['/gz'], { normalise: normalisers.analysisResultGz })).counts.identical).toBe(
      1
    );
    // Byte for byte apart from the token: no JSON round trip to lose a digit.
    const strip = (text) => normalisers.analysisResult(Buffer.from(text)).toString();
    expect(strip('{"summary":{"token":"T1"},"n":9007199254740993}')).toBe(
      '{"summary":{"token":""},"n":9007199254740993}'
    );
    expect(strip('{"summary":{"token":"T1"},"n":-0}')).not.toBe(
      strip('{"summary":{"token":"T1"},"n":0}')
    );
  });

  it('records a failure as an error, with no body or secret in it, and does not stop', async () => {
    const report = await run(['/text404', '/same', '/hang'], {
      normalise: normalisers.analysisResultGz,
      redact: true,
      timeout: 300,
    });
    expect(report.results.map((r) => r.error !== undefined)).toEqual([true, true, true]);
    expect(report.counts.errors).toBe(3);
    expect(JSON.stringify(report)).not.toContain('secret-body-text');
    expect(verdict(report)).toBe(2);
    const plain = await run(['/same', '/hang'], { timeout: 300 });
    expect(plain.counts).toEqual({ identical: 1, different: 0, errors: 1 });
  });

  it('never puts a body, and with redaction no path, in its report', async () => {
    const report = await run(['/secret/ABC123'], { redact: true });
    expect(JSON.stringify(report)).not.toContain('ABC123');
    expect(report.results[0].request).toBe('#0');
    expect(Object.keys(report.results[0]).sort()).toEqual(['differs', 'request', 'status']);
  });

  it('calibrates against the reference itself: a difference counts only where the reference agreed with itself', async () => {
    const report = await run(['/same', '/byte'], { calibrate: true });
    expect(report.results.map((r) => r.calibrated)).toEqual([true, true]);
    expect(report.counts).toEqual({ identical: 1, different: 1 });
    // A reference that disagrees with itself is unstable, counted neither way,
    // and a run that compared nothing is not a pass.
    const live = await run(['/live'], { calibrate: true });
    expect(live.counts).toEqual({ identical: 0, different: 0, unstable: 1 });
    expect(live.results[0].calibrated).toBe(false);
    expect(verdict(live)).toBe(2);
  });

  it('asks both at once with --simultaneous, with the same result', async () => {
    const report = await run(['/same', '/byte'], { simultaneous: true });
    expect(report.counts).toEqual({ identical: 1, different: 1 });
  });

  it("keeps a base URL's path, and refuses a scheme or query it cannot honour", async () => {
    // Without the prefix both sides would answer the same 404 -- a false pass.
    const report = await compareAll([{ method: 'GET', path: '/x' }], {
      reference: `${ref.url}/ctx`,
      candidate: `${cand.url}/ctx`,
    });
    expect(report.counts).toEqual({ identical: 0, different: 1 });
    for (const bad of ['ftp://127.0.0.1:1', `${ref.url}/?q=1`])
      await expect(
        compareAll([{ path: '/x' }], { reference: bad, candidate: cand.url })
      ).rejects.toThrow(/base/);
  });

  it('times out the whole request, not just a silence', async () => {
    const started = Date.now();
    const report = await run(['/trickle'], { timeout: 300 });
    expect(report.results[0].error).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('sees a header sent twice', async () => {
    const report = await run(['/twice']);
    expect(report.results[0].differs).toContain('content-type');
    // And how the body was framed: Content-Length on one side, chunked on the other.
    expect(report.results[0].differs).toContain('transfer-encoding');
  });

  it('names what failed: the normaliser, not the network', async () => {
    const report = await run(['/same'], { normalise: normalisers.analysisResultGz });
    expect(report.results[0].error).toBe('normaliser');
    // A token normaliser that finds no token is an error, not a silent pass.
    expect(() => normalisers.analysisResult(Buffer.from('{"n":1}'))).toThrow();
  });

  it('reports a status difference even when the body cannot be normalised', async () => {
    const report = await run(['/status'], { normalise: normalisers.analysisResult });
    expect(report.results[0].differs).toContain('status');
  });

  it('ignores a header only when the run declares it, and says so', async () => {
    const report = await run(['/header'], { ignoreHeaders: ['content-disposition'] });
    expect(report.counts.identical).toBe(1);
    expect(report.ignoredHeaders).toEqual(['content-disposition']);
  });
});
