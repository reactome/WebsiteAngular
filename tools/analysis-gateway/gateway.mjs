/**
 * The analysis gateway (spec 010 Story 6): in front of the AnalysisService,
 * admitting a few computations at a time and passing everything else through
 * unchanged.
 *
 * Nothing limited how many analyses ran at once. Twelve at once took 10.5 to
 * 12.6 s each against 2 s alone (research R12): none waits and none is
 * refused, all finish late, so a burst large enough takes every analysis in
 * it past the edge's 100 s and fails them together. Here a few run at full
 * speed, the rest wait in arrival order for a bounded time, and beyond that
 * a reader is told at once that the service is busy and when to try again.
 *
 * The AnalysisService itself is unchanged Java (decided 19 Oct 2026). This
 * only decides when a request reaches it, and hands back its answer as it
 * came: status, headers in their order and case, and body.
 *
 *   ANALYSIS_UPSTREAM   the AnalysisService's origin, default http://127.0.0.1:8080
 *   GATEWAY_PORT        default 4320; GATEWAY_HOST default 127.0.0.1
 *   ANALYSIS_LIMIT      analyses at once, default 4 (below analysis-core's pool of 5)
 *   REPORT_LIMIT        PDF reports at once, default 1
 *   QUEUE_LENGTH        waiting per lane before refusing, default 40
 *   MAX_WAIT_MS         longest wait, default 60000 (wait + run inside the edge's 100 s)
 *   RETRY_AFTER         seconds a refused reader is told to wait, default 10
 */
import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * Which lane a request takes, or undefined for one that passes straight
 * through: by method and path, as the AnalysisService's own operations are.
 */
export function classify(method, url) {
  const path = String(url).split('?')[0];
  if (method === 'POST' && /^\/AnalysisService\/(identifiers|mapping|import)\//.test(path))
    return 'analysis';
  if (
    method === 'GET' &&
    /^\/AnalysisService\/(identifier\/[^/]+(\/projection)?|species\/homoSapiens\/[^/]+)\/?$/.test(
      path
    )
  )
    return 'analysis';
  if (method === 'GET' && /^\/AnalysisService\/report\//.test(path)) return 'report';
  return undefined;
}

/** Connection-scoped headers, which describe one hop and are not passed on. */
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade']);

/** The service's own error envelope, as it writes a 404 or a 410. */
function busy(res, retryAfter) {
  const body = JSON.stringify({
    code: 503,
    reason: 'Service Unavailable',
    messages: [`The analysis service is busy; try again in ${retryAfter} seconds`],
  });
  res.writeHead(503, {
    'Content-Type': 'application/json',
    'Retry-After': String(retryAfter),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function gateway({
  upstream = 'http://127.0.0.1:8080',
  limits = { analysis: 4, report: 1 },
  queueLength = 40,
  maxWaitMs = 60_000,
  retryAfter = 10,
} = {}) {
  const target = new URL(upstream);
  const lanes = Object.fromEntries(
    Object.entries(limits).map(([name, limit]) => [name, { limit, active: 0, waiting: [] }])
  );
  const counts = { passed: 0, admitted: 0, waited: 0, refused: 0, left: 0, failed: 0 };

  /** Send the request on, and its answer back as it came. `done` once it is over. */
  function pass(req, res, done = () => {}) {
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (!HOP.has(req.rawHeaders[i].toLowerCase()))
        headers.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    const call = httpRequest(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers },
      (answer) => {
        const back = [];
        for (let i = 0; i < answer.rawHeaders.length; i += 2)
          if (!HOP.has(answer.rawHeaders[i].toLowerCase()))
            back.push(answer.rawHeaders[i], answer.rawHeaders[i + 1]);
        res.writeHead(answer.statusCode, answer.statusMessage, back);
        answer.pipe(res);
        answer.on('end', finish);
        answer.on('error', finish);
      }
    );
    call.on('error', () => {
      counts.failed++;
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 502,
            reason: 'Bad Gateway',
            messages: ['The analysis service cannot be reached'],
          })
        );
      } else res.destroy();
      finish();
    });
    // The reader gone mid-answer: stop asking the service for it.
    res.on('close', () => {
      if (!res.writableFinished) call.destroy();
      finish();
    });
    req.pipe(call);
  }

  function admit(lane, req, res) {
    // Never for a reader already gone: their request could not be sent, and
    // its place would never be given back.
    if (res.destroyed || req.destroyed) {
      counts.left++;
      return;
    }
    lane.active++;
    counts.admitted++;
    pass(req, res, () => {
      lane.active--;
      next(lane);
    });
  }

  function next(lane) {
    while (lane.active < lane.limit && lane.waiting.length) {
      const entry = lane.waiting.shift();
      clearTimeout(entry.timer);
      admit(lane, entry.req, entry.res);
    }
  }

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(
        JSON.stringify({
          ok: true,
          upstream: target.origin,
          lanes: Object.fromEntries(
            Object.entries(lanes).map(([name, lane]) => [
              name,
              { limit: lane.limit, active: lane.active, waiting: lane.waiting.length },
            ])
          ),
          queueLength,
          maxWaitMs,
          ...counts,
        })
      );
      return;
    }
    const name = classify(req.method, req.url);
    const lane = name && lanes[name];
    if (!lane) {
      counts.passed++;
      pass(req, res);
      return;
    }
    if (lane.active < lane.limit) {
      admit(lane, req, res);
      return;
    }
    if (lane.waiting.length >= queueLength) {
      counts.refused++;
      busy(res, retryAfter);
      return;
    }
    counts.waited++;
    const entry = { req, res };
    const leave = () => {
      const at = lane.waiting.indexOf(entry);
      if (at === -1) return false;
      lane.waiting.splice(at, 1);
      clearTimeout(entry.timer);
      return true;
    };
    entry.timer = setTimeout(() => {
      if (leave()) {
        counts.refused++;
        busy(res, retryAfter);
      }
    }, maxWaitMs);
    // A reader who gives up while waiting loses their place; nothing is run.
    res.on('close', () => {
      if (!res.writableFinished && leave()) counts.left++;
    });
    lane.waiting.push(entry);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const number = (name, fallback) => (env[name] ? Number(env[name]) : fallback);
  const port = number('GATEWAY_PORT', 4320);
  const host = env.GATEWAY_HOST || '127.0.0.1';
  const server = gateway({
    upstream: env.ANALYSIS_UPSTREAM || 'http://127.0.0.1:8080',
    limits: { analysis: number('ANALYSIS_LIMIT', 4), report: number('REPORT_LIMIT', 1) },
    queueLength: number('QUEUE_LENGTH', 40),
    maxWaitMs: number('MAX_WAIT_MS', 60_000),
    retryAfter: number('RETRY_AFTER', 10),
  });
  // Analyses and their uploads are not quick: no idle timeout of our own.
  server.requestTimeout = 0;
  // Longer than nginx keeps an idle pooled connection (10 s), so nginx always
  // closes first and never hands out a socket this has already closed.
  server.keepAliveTimeout = 15_000;
  server.headersTimeout = 20_000;
  server.listen(port, host, () => console.log(`analysis-gateway on http://${host}:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
