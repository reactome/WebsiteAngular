// @vitest-environment node
//
// The analysis gateway (spec 010 Story 6): computations wait their turn in
// front of the AnalysisService, and everything passes through unchanged.
// A stand-in AnalysisService holds each computation open until the test lets
// it finish, so what waits, what runs and what is refused can be watched.
import { createServer, request as httpRequest } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { classify, gateway } from './gateway.mjs';

const seen = [];
/** Every request the service was sent, recorded as it arrives, body or not. */
const arrived = [];
const headersSeen = [];
const held = [];
let upstream;
let upstreamUrl;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    arrived.push(req.url);
    headersSeen.push(req.rawHeaders);
    // A service that answers slowly: headers now, the rest when let go.
    if (req.url.includes('trickle')) {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.write('%PDF-');
      held.push(() => res.end('rest'));
      return;
    }
    // A service that fails mid-answer: half a body, then the connection gone.
    if (req.url.includes('broken')) {
      res.writeHead(200, { 'Content-Length': '1000' });
      res.write('x'.repeat(100));
      setTimeout(() => res.socket.destroy(), 20);
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${body.length}`);
      const finish = () => {
        // Headers in an order and case Express would not produce, and a
        // duplicate: what passes through must be what was sent.
        res.writeHead(200, [
          'Content-Type',
          'application/json;charset=UTF-8',
          'X-Odd-Case',
          'One',
          'Set-Cookie',
          'a=1',
          'Set-Cookie',
          'b=2',
        ]);
        res.end(JSON.stringify({ path: req.url, length: body.length }));
      };
      if (/\/(identifiers|species|report)\//.test(req.url) && !req.url.includes('quick'))
        held.push(finish);
      else finish();
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
});
afterAll(() => new Promise((resolve) => upstream.close(resolve)));
beforeEach(() => {
  seen.length = 0;
  arrived.length = 0;
  headersSeen.length = 0;
  held.length = 0;
});

/** A gateway on its own port, with small limits, for one test. */
async function start(settings) {
  const server = gateway({
    upstream: upstreamUrl,
    limits: { analysis: 2, report: 1 },
    queueLength: 2,
    maxWaitMs: 2000,
    retryAfter: 7,
    ...settings,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((resolve) => server.close(resolve)) };
}

const post = (base, path, body = 'P04637') =>
  fetch(base + path, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe('classify', () => {
  it('names the computations by method and path, and lets everything else through', () => {
    const cases = [
      ['POST', '/AnalysisService/identifiers/', 'analysis'],
      ['POST', '/AnalysisService/identifiers/projection?interactors=true', 'analysis'],
      ['POST', '/AnalysisService/identifiers/form/projection', 'analysis'],
      ['POST', '/AnalysisService/identifiers/url', 'analysis'],
      ['POST', '/AnalysisService/mapping/form', 'analysis'],
      ['POST', '/AnalysisService/import/', 'analysis'],
      ['GET', '/AnalysisService/identifier/P04637/projection', 'analysis'],
      ['GET', '/AnalysisService/species/homoSapiens/48892', 'analysis'],
      ['GET', '/AnalysisService/report/MjAy/Homo%20sapiens/r.pdf', 'report'],
      ['GET', '/AnalysisService/token/MjAy', undefined],
      ['POST', '/AnalysisService/token/MjAy/filter/pathways', undefined],
      ['GET', '/AnalysisService/download/MjAy/result.json.gz', undefined],
      ['GET', '/AnalysisService/database/version', undefined],
      ['GET', '/AnalysisService/identifiers/', undefined],
    ];
    for (const [method, url, lane] of cases)
      expect([method, url, classify(method, url)]).toEqual([method, url, lane]);
  });
});

describe('the queue', () => {
  it('runs a computation beyond the limit once one finishes, in arrival order', async () => {
    const { base, close } = await start();
    try {
      const answers = [1, 2, 3].map((n) => post(base, `/AnalysisService/identifiers/?n=${n}`));
      await until(() => held.length === 2);
      expect(seen.map((s) => s.split(' ')[1])).toEqual([
        '/AnalysisService/identifiers/?n=1',
        '/AnalysisService/identifiers/?n=2',
      ]);
      held.shift()();
      await until(() => held.length === 2);
      expect(seen.at(-1)).toContain('n=3');
      held.splice(0).forEach((finish) => finish());
      expect((await Promise.all(answers)).map((r) => r.status)).toEqual([200, 200, 200]);
    } finally {
      await close();
    }
  });

  it("refuses, at once and in the service's error format, beyond the waiting list", async () => {
    const { base, close } = await start();
    try {
      const answers = [1, 2, 3, 4].map((n) => post(base, `/AnalysisService/identifiers/?n=${n}`));
      await until(() => held.length === 2);
      const refused = await post(base, '/AnalysisService/identifiers/?n=5');
      expect([refused.status, refused.headers.get('retry-after'), await refused.json()]).toEqual([
        503,
        '7',
        {
          code: 503,
          reason: 'Service Unavailable',
          messages: ['The analysis service is busy; try again in 7 seconds'],
        },
      ]);
      held.splice(0).forEach((finish) => finish());
      await until(() => held.length === 2);
      held.splice(0).forEach((finish) => finish());
      await Promise.all(answers);
      expect(seen.some((s) => s.includes('n=5'))).toBe(false);
    } finally {
      await close();
    }
  });

  it('refuses one that has waited as long as it may, and never runs it', async () => {
    const { base, close } = await start({ maxWaitMs: 100 });
    try {
      const running = [1, 2].map((n) => post(base, `/AnalysisService/identifiers/?n=${n}`));
      await until(() => held.length === 2);
      const late = await post(base, '/AnalysisService/identifiers/?n=3');
      expect(late.status).toBe(503);
      held.splice(0).forEach((finish) => finish());
      await Promise.all(running);
      expect(seen.some((s) => s.includes('n=3'))).toBe(false);
    } finally {
      await close();
    }
  });

  it('keeps reports on a lane of their own', async () => {
    const { base, close } = await start();
    try {
      const report = fetch(`${base}/AnalysisService/report/T/Homo%20sapiens/r.pdf`);
      await until(() => held.length === 1);
      // Analyses still run while a report holds its own lane.
      const analysis = post(base, '/AnalysisService/identifiers/?n=1');
      await until(() => held.length === 2);
      held.splice(0).forEach((finish) => finish());
      expect((await report).status).toBe(200);
      expect((await analysis).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('never holds back a stored result, a download or the metadata', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 }, queueLength: 0 });
    try {
      const running = post(base, '/AnalysisService/identifiers/?n=1');
      await until(() => held.length === 1);
      for (const path of [
        '/AnalysisService/token/T',
        '/AnalysisService/download/T/result.json.gz',
        '/AnalysisService/database/version',
      ])
        expect([path, (await fetch(base + path)).status]).toEqual([path, 200]);
      held.splice(0).forEach((finish) => finish());
      await running;
    } finally {
      await close();
    }
  });

  it('releases the place of a reader who leaves while waiting, and never runs their request', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 } });
    try {
      const running = post(base, '/AnalysisService/identifiers/?n=1');
      await until(() => held.length === 1);
      const gone = new AbortController();
      const leaving = post(base, '/AnalysisService/identifiers/?n=2').catch(() => 'left');
      // A request object we can abort: fetch's own signal.
      const leaver = fetch(`${base}/AnalysisService/identifiers/?n=3`, {
        method: 'POST',
        body: 'X',
        signal: gone.signal,
      }).catch(() => 'left');
      await new Promise((r) => setTimeout(r, 50));
      expect((await (await fetch(`${base}/health`)).json()).lanes.analysis.waiting).toBe(2);
      gone.abort();
      expect(await leaver).toBe('left');
      // Its place is given up at once, not when its turn comes.
      await new Promise((r) => setTimeout(r, 50));
      expect((await (await fetch(`${base}/health`)).json()).lanes.analysis.waiting).toBe(1);
      held.shift()();
      await until(() => held.length === 1);
      held.shift()();
      await leaving;
      // The lane is free for the next reader: nothing holds a place for one
      // who has gone.
      const after = post(base, '/AnalysisService/identifiers/?n=4');
      await until(() => held.length === 1);
      held.shift()();
      expect((await after).status).toBe(200);
      // Not even sent: a request whose reader has gone never reaches the service.
      expect(arrived.some((url) => url.includes('n=3'))).toBe(false);
      await running;
    } finally {
      await close();
    }
  });
});

describe('passing through', () => {
  it('hands back the status, headers and body exactly as the service sent them', async () => {
    const { base, close } = await start();
    try {
      const answer = await new Promise((resolve, reject) => {
        const url = new URL(`${base}/AnalysisService/token/T?page=1`);
        const call = httpRequest(
          { host: url.hostname, port: url.port, path: url.pathname + url.search },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, raw: res.rawHeaders, body }));
          }
        );
        call.on('error', reject);
        call.end();
      });
      expect(answer.status).toBe(200);
      expect(answer.body).toBe(
        JSON.stringify({ path: '/AnalysisService/token/T?page=1', length: 0 })
      );
      const pairs = [];
      for (let i = 0; i < answer.raw.length; i += 2) pairs.push([answer.raw[i], answer.raw[i + 1]]);
      expect(
        pairs.filter(
          ([name]) => !/^(date|connection|keep-alive|transfer-encoding|content-length)$/i.test(name)
        )
      ).toEqual([
        ['Content-Type', 'application/json;charset=UTF-8'],
        ['X-Odd-Case', 'One'],
        ['Set-Cookie', 'a=1'],
        ['Set-Cookie', 'b=2'],
      ]);
    } finally {
      await close();
    }
  });

  it('streams a large upload through whole', async () => {
    const { base, close } = await start();
    try {
      const big = 'P04637\n'.repeat(400_000);
      const answer = await post(base, '/AnalysisService/identifiers/quick', big);
      expect(await answer.json()).toEqual({
        path: '/AnalysisService/identifiers/quick',
        length: big.length,
      });
    } finally {
      await close();
    }
  });

  it('reports the queue on its health check', async () => {
    const { base, close } = await start();
    try {
      const health = await (await fetch(`${base}/health`)).json();
      expect(health).toMatchObject({
        ok: true,
        lanes: {
          analysis: { limit: 2, active: 0, waiting: 0 },
          report: { limit: 1, active: 0, waiting: 0 },
        },
        queueLength: 2,
        maxWaitMs: 2000,
      });
    } finally {
      await close();
    }
  });
});

describe('the review of #539', () => {
  it('admits those waiting in the order they came', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 }, queueLength: 5 });
    try {
      const answers = [1, 2, 3, 4].map((n) => post(base, `/AnalysisService/identifiers/?n=${n}`));
      for (let turn = 1; turn <= 4; turn++) {
        await until(() => held.length === 1);
        expect(seen.at(-1)).toContain(`n=${turn}`);
        held.shift()();
      }
      await Promise.all(answers);
    } finally {
      await close();
    }
  });

  it('closes the reader’s connection at once when the service fails mid-answer', async () => {
    const { base, close } = await start();
    try {
      const started = Date.now();
      const outcome = await fetch(`${base}/AnalysisService/token/broken`)
        .then((r) => r.text())
        .then(
          () => 'whole',
          () => 'cut'
        );
      expect([outcome, Date.now() - started < 2000]).toEqual(['cut', true]);
    } finally {
      await close();
    }
  });

  it('holds a place until the service finishes, even when the reader left mid-analysis', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 } });
    try {
      const gone = new AbortController();
      const leaver = fetch(`${base}/AnalysisService/identifiers/?n=1`, {
        method: 'POST',
        body: 'X',
        signal: gone.signal,
      }).catch(() => 'left');
      await until(() => held.length === 1);
      gone.abort();
      await leaver;
      const next = post(base, '/AnalysisService/identifiers/?n=2');
      await new Promise((r) => setTimeout(r, 100));
      // Still computing for the reader who left: the next waits.
      expect(arrived.some((url) => url.includes('n=2'))).toBe(false);
      held.shift()();
      await until(() => held.length === 1);
      held.shift()();
      expect((await next).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('sees a reader with a large upload leave while waiting, and never runs it', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 } });
    try {
      const running = post(base, '/AnalysisService/identifiers/?n=1');
      await until(() => held.length === 1);
      const gone = new AbortController();
      const leaver = fetch(`${base}/AnalysisService/identifiers/?n=2`, {
        method: 'POST',
        body: 'P04637\n'.repeat(500_000),
        signal: gone.signal,
      }).catch(() => 'left');
      await new Promise((r) => setTimeout(r, 200));
      gone.abort();
      await leaver;
      await new Promise((r) => setTimeout(r, 100));
      const health = await (await fetch(`${base}/health`)).json();
      expect([health.lanes.analysis.waiting, health.left, health.heldBytes]).toEqual([0, 1, 0]);
      held.shift()();
      await running;
      expect(arrived.some((url) => url.includes('n=2'))).toBe(false);
    } finally {
      await close();
    }
  });

  it('sends a large upload whole once it is admitted from the waiting list', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 } });
    try {
      const running = post(base, '/AnalysisService/identifiers/?n=1');
      await until(() => held.length === 1);
      const big = 'P04637\n'.repeat(500_000);
      const waited = post(base, '/AnalysisService/identifiers/?n=2', big);
      await new Promise((r) => setTimeout(r, 200));
      held.shift()();
      await until(() => held.length === 1);
      held.shift()();
      expect(await (await waited).json()).toEqual({
        path: '/AnalysisService/identifiers/?n=2',
        length: big.length,
      });
      await running;
    } finally {
      await close();
    }
  });

  it('queues what Tomcat would route to a computation, however it is spelled', () => {
    for (const [method, url] of [
      ['HEAD', '/AnalysisService/identifier/PTEN'],
      ['HEAD', '/AnalysisService/report/T/Homo%20sapiens/r.pdf'],
      ['POST', '/AnalysisService/identifiers;x/projection'],
      ['POST', '/AnalysisService/%69dentifiers/projection'],
      ['GET', '/AnalysisService/%69dentifier/PTEN'],
      ['POST', '/AnalysisService//identifiers/'],
    ])
      expect([method, url, classify(method, url) !== undefined]).toEqual([method, url, true]);
    expect(classify('POST', '/AnalysisService/report/T/x.pdf')).toBe(undefined);
  });

  it('is the 502 a reader can act on when the service cannot be reached', async () => {
    const { base, close } = await start({ upstream: 'http://127.0.0.1:9' });
    try {
      const answer = await fetch(`${base}/AnalysisService/token/T`);
      expect([
        answer.status,
        answer.headers.get('cache-control'),
        (await answer.json()).reason,
      ]).toEqual([502, 'no-store', 'Bad Gateway']);
    } finally {
      await close();
    }
  });

  it('does not pass connection-scoped headers on, and keeps a refusal out of every cache', async () => {
    const { base, close } = await start({ limits: { analysis: 1, report: 1 }, queueLength: 0 });
    try {
      await new Promise((resolve, reject) => {
        const url = new URL(`${base}/AnalysisService/token/T`);
        const call = httpRequest(
          {
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { 'Keep-Alive': 'timeout=5', 'X-Kept': 'yes' },
          },
          (res) => res.resume().on('end', resolve)
        );
        call.on('error', reject);
        call.end();
      });
      const names = headersSeen
        .at(-1)
        .filter((_, i) => i % 2 === 0)
        .map((n) => n.toLowerCase());
      expect([names.includes('keep-alive'), names.includes('x-kept')]).toEqual([false, true]);
      const running = post(base, '/AnalysisService/identifiers/?n=1');
      await until(() => held.length === 1);
      const refused = await post(base, '/AnalysisService/identifiers/?n=2');
      expect(refused.headers.get('cache-control')).toBe('no-store');
      held.shift()();
      await running;
    } finally {
      await close();
    }
  });
});

describe('a reader who leaves mid-answer', () => {
  it('keeps the place until the service has finished the answer', async () => {
    const { base, close } = await start();
    try {
      const gone = new AbortController();
      const first = await fetch(`${base}/AnalysisService/report/T/x/trickle.pdf`, {
        signal: gone.signal,
      });
      expect(first.status).toBe(200);
      gone.abort();
      const second = fetch(`${base}/AnalysisService/report/T/x/second.pdf`);
      await new Promise((r) => setTimeout(r, 100));
      expect(arrived.some((url) => url.includes('second'))).toBe(false);
      held.shift()();
      await until(() => held.length === 1);
      held.shift()();
      expect((await second).status).toBe(200);
    } finally {
      await close();
    }
  });
});
