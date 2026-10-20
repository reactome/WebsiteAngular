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
 *   GATEWAY_PORT        default 4350; GATEWAY_HOST default 127.0.0.1
 *   ANALYSIS_LIMIT      analyses at once, default 4 (below analysis-core's pool of 5)
 *   REPORT_LIMIT        PDF reports at once, default 1
 *   QUEUE_LENGTH        waiting per lane before refusing, default 40
 *   MAX_WAIT_MS         longest wait, default 60000 (wait + run inside the edge's 100 s)
 *   RETRY_AFTER         seconds a refused reader is told to wait, default 10
 *   WAITING_BYTES       bodies held while waiting, in all, default 268435456 (256 MB)
 *   UPSTREAM_TIMEOUT_MS silence from the service before a call is given up, default
 *                       300000 (nginx's own read timeout, after which the reader is gone)
 */
import { realpathSync } from 'node:fs';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { fileURLToPath } from 'node:url';

/** The queues: computations, and the PDF reports, each with its own limit. */
type LaneName = 'analysis' | 'report';

/** What was read of a waiting request's body before its turn came. */
interface HeldBody {
  chunks: Buffer[];
  bytes: number;
  ended: boolean;
}

/** A request waiting its turn. */
interface Waiting {
  req: IncomingMessage;
  res: ServerResponse;
  body: HeldBody;
  /** Stops reading into `body` and gives its bytes back to the budget. */
  settle: () => void;
  timer: NodeJS.Timeout;
}

interface Lane {
  limit: number;
  active: number;
  waiting: Waiting[];
}

/** What /health answers: each lane's state, the settings, and the counts so far. */
export interface Health {
  ok: true;
  upstream: string;
  lanes: Record<LaneName, { limit: number; active: number; waiting: number }>;
  queueLength: number;
  maxWaitMs: number;
  heldBytes: number;
  passed: number;
  admitted: number;
  waited: number;
  refused: number;
  left: number;
  failed: number;
}

export interface GatewaySettings {
  upstream?: string;
  limits?: Record<LaneName, number>;
  queueLength?: number;
  maxWaitMs?: number;
  retryAfter?: number;
  waitingBytes?: number;
  upstreamTimeoutMs?: number;
}

/**
 * The path as Tomcat routes it: each segment's `;` parameters cut, percent-
 * escapes decoded, runs of slashes made one. Classified as written, a request
 * spelled `identifiers;x/projection` or `%69dentifier/PTEN` ran a computation
 * past the queue, since Tomcat reads it as the plain path.
 */
function routedPath(url: string | undefined): string {
  return (String(url).split('?')[0] ?? '')
    .split('/')
    .map((segment) => {
      const kept = segment.split(';')[0] ?? '';
      try {
        return decodeURIComponent(kept);
      } catch {
        return kept;
      }
    })
    .join('/')
    .replace(/\/{2,}/g, '/');
}

/**
 * Which lane a request takes, or undefined for one that passes straight
 * through: by method and the path Tomcat routes, as the AnalysisService's own
 * operations are. A HEAD runs its GET's handler, so it is classed as one.
 */
export function classify(
  method: string | undefined,
  url: string | undefined
): LaneName | undefined {
  const verb = method === 'HEAD' ? 'GET' : method;
  const path = routedPath(url);
  if (verb === 'POST' && /^\/AnalysisService\/(identifiers|mapping|import)\//.test(path))
    return 'analysis';
  if (
    verb === 'GET' &&
    /^\/AnalysisService\/(identifier\/[^/]+(\/projection)?|species\/homoSapiens\/[^/]+)\/?$/.test(
      path
    )
  )
    return 'analysis';
  if (verb === 'GET' && /^\/AnalysisService\/report\//.test(path)) return 'report';
  return undefined;
}

/** Connection-scoped headers, which describe one hop and are not passed on. */
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade']);

/** Raw headers, name and value alternating, without the hop-by-hop ones. */
const without = (raw: string[]): string[] => {
  const kept: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] as string;
    if (!HOP.has(name.toLowerCase())) kept.push(name, raw[i + 1] as string);
  }
  return kept;
};

/** The service's own error envelope, as it writes a 404 or a 410. */
function busy(res: ServerResponse, retryAfter: number): void {
  if (res.headersSent || res.destroyed) return;
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
  waitingBytes = 256 * 1024 * 1024,
  upstreamTimeoutMs = 300_000,
}: GatewaySettings = {}) {
  const target = new URL(upstream);
  const lanes: Record<LaneName, Lane> = {
    analysis: { limit: limits.analysis, active: 0, waiting: [] },
    report: { limit: limits.report, active: 0, waiting: [] },
  };
  const counts = { passed: 0, admitted: 0, waited: 0, refused: 0, left: 0, failed: 0 };
  let held = 0;

  /**
   * Send the request on, and its answer back as it came; `done` once the
   * service has finished with it. `body` is what was read while it waited,
   * if anything: the rest still comes from `req`.
   */
  function pass(
    req: IncomingMessage,
    res: ServerResponse,
    { done = () => {}, body }: { done?: () => void; body?: HeldBody } = {}
  ): void {
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      done();
    };
    const call = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: without(req.rawHeaders),
      },
      (answer) => {
        // Over only when the service is: a reader who left mid-answer does not
        // stop a computation already under way, so its place is held until
        // the service has finished and the rest of the answer is discarded.
        answer.on('end', finish);
        answer.on('error', () => {
          // The service failed mid-answer: say so to the reader at once,
          // rather than leave them waiting on a body that will not come.
          res.destroy();
          finish();
        });
        if (res.destroyed) {
          answer.resume();
          return;
        }
        // Always set on an answer from the service; the type allows otherwise.
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, without(answer.rawHeaders));
        answer.pipe(res);
        res.on('close', () => {
          if (!res.writableFinished) {
            answer.unpipe(res);
            answer.resume();
          }
        });
      }
    );
    call.on('error', () => {
      counts.failed++;
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
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
    // A service that says nothing for as long as nginx waits has lost the
    // reader already; without this a hung call held its place until Tomcat
    // restarted, and four of them closed the lane.
    call.setTimeout(upstreamTimeoutMs, () => call.destroy(new Error('upstream timeout')));
    // A reader who leaves mid-upload: the service would wait for the rest of
    // the body until its own read timeout, holding the place for nothing.
    // Once the upload is whole, leaving changes nothing (see above).
    req.on('close', () => {
      if (!req.complete) call.destroy();
    });
    if (body) {
      for (const chunk of body.chunks) call.write(chunk);
      if (body.ended) call.end();
      else req.pipe(call);
    } else req.pipe(call);
  }

  function admit(lane: Lane, req: IncomingMessage, res: ServerResponse, body?: HeldBody): void {
    lane.active++;
    counts.admitted++;
    pass(req, res, {
      ...(body && { body }),
      done: () => {
        lane.active--;
        next(lane);
      },
    });
  }

  function next(lane: Lane): void {
    while (lane.active < lane.limit) {
      const entry = lane.waiting.shift();
      if (!entry) return;
      entry.settle();
      admit(lane, entry.req, entry.res, entry.body);
    }
  }

  function wait(lane: Lane, req: IncomingMessage, res: ServerResponse): void {
    counts.waited++;
    // Read while waiting, so a reader who leaves is seen leaving: with the
    // body unread, a closed connection goes unnoticed and the analysis runs
    // in full for nobody. Held in memory up to a budget for all who wait;
    // beyond it a body is left unread, and only its leaving goes unseen.
    const body: HeldBody = { chunks: [], bytes: 0, ended: false };
    const onData = (chunk: Buffer) => {
      body.chunks.push(chunk);
      body.bytes += chunk.length;
      held += chunk.length;
      if (held > waitingBytes) req.pause();
    };
    const onEnd = () => {
      body.ended = true;
    };
    req.on('data', onData);
    req.on('end', onEnd);
    const release = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      held -= body.bytes;
      clearTimeout(entry.timer);
    };
    // What was read is sent from `body`; the rest comes by pipe, which
    // resumes the request itself.
    const entry: Waiting = {
      req,
      res,
      body,
      settle: release,
      timer: setTimeout(() => {
        if (leave()) {
          counts.refused++;
          busy(res, retryAfter);
        }
      }, maxWaitMs),
    };
    const leave = () => {
      const at = lane.waiting.indexOf(entry);
      if (at === -1) return false;
      lane.waiting.splice(at, 1);
      release();
      return true;
    };
    // A reader who gives up while waiting loses their place; nothing is run.
    const gone = () => {
      if (!res.writableFinished && leave()) counts.left++;
    };
    res.on('close', gone);
    req.on('aborted', gone);
    lane.waiting.push(entry);
  }

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      const state = (lane: Lane) => ({
        limit: lane.limit,
        active: lane.active,
        waiting: lane.waiting.length,
      });
      const health: Health = {
        ok: true,
        upstream: target.origin,
        lanes: { analysis: state(lanes.analysis), report: state(lanes.report) },
        queueLength,
        maxWaitMs,
        heldBytes: held,
        ...counts,
      };
      res.end(JSON.stringify(health));
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
    wait(lane, req, res);
  });
  return server;
}

/**
 * Whether Node was started with this file, whatever it is called or however
 * it was reached (as the content and render services decide, spec 013).
 */
function startedDirectly(): boolean {
  try {
    return (
      Boolean(process.argv[1]) &&
      realpathSync(process.argv[1] as string) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  const env = process.env;
  const number = (name: string, fallback: number) => (env[name] ? Number(env[name]) : fallback);
  const port = number('GATEWAY_PORT', 4350);
  const host = env['GATEWAY_HOST'] || '127.0.0.1';
  const server = gateway({
    upstream: env['ANALYSIS_UPSTREAM'] || 'http://127.0.0.1:8080',
    limits: { analysis: number('ANALYSIS_LIMIT', 4), report: number('REPORT_LIMIT', 1) },
    queueLength: number('QUEUE_LENGTH', 40),
    maxWaitMs: number('MAX_WAIT_MS', 60_000),
    retryAfter: number('RETRY_AFTER', 10),
    waitingBytes: number('WAITING_BYTES', 256 * 1024 * 1024),
    upstreamTimeoutMs: number('UPSTREAM_TIMEOUT_MS', 300_000),
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
