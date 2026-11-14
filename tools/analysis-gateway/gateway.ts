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
 * The analysis report PDF, `GET /AnalysisService/report/…`, is not the
 * AnalysisService's any more: it goes to pdf-export (its spec 002, research
 * R6), a second upstream, and is not queued. pdf-export makes a report in the
 * background and holds each request up to 30 s, so a lane of one would make
 * every browser asking again wait for the others; its own limits protect it.
 * A client's reports in flight still count towards its share (PER_CLIENT),
 * refused past it, and pdf-export is told who the client is in
 * X-Reactome-Client, always this gateway's own reading of it.
 *
 *   ANALYSIS_UPSTREAM   the AnalysisService's origin, default http://127.0.0.1:8080
 *   REPORT_UPSTREAM     pdf-export's origin, default http://127.0.0.1:4370
 *   GATEWAY_PORT        default 4350; GATEWAY_HOST default 127.0.0.1
 *   ANALYSIS_LIMIT      analyses at once, default 4 (below analysis-core's pool of 5)
 *   QUEUE_LENGTH        analyses waiting before refusing, default 40
 *   PER_CLIENT          one client's analyses running or waiting, and reports in
 *                       flight, at once, default 8: beyond it, an analysis that
 *                       would have to wait is refused (with places free, it still
 *                       runs), and a report is refused
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

/**
 * What a request is: a computation, which waits its turn here, or a PDF report,
 * which goes to pdf-export without waiting.
 */
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
  /** Gives its client's place back; called once, when it is done here. */
  out: () => void;
  /** Stops reading into `body` and gives its bytes back to the budget. */
  settle: () => void;
  timer: NodeJS.Timeout;
}

interface Lane {
  limit: number;
  active: number;
  waiting: Waiting[];
}

/** What /health answers: the queue's state, the settings, and the counts so far. */
export interface Health {
  ok: true;
  upstream: string;
  lanes: { analysis: { limit: number; active: number; waiting: number } };
  /** pdf-export, and the reports passed to it now. */
  reports: { upstream: string; active: number };
  queueLength: number;
  maxWaitMs: number;
  perClient: number;
  /** Clients with a computation running or waiting. */
  clients: number;
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
  /** pdf-export's origin, where the reports go. */
  reportUpstream?: string;
  limits?: { analysis: number };
  queueLength?: number;
  maxWaitMs?: number;
  perClient?: number;
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
const without = (raw: string[], also: ReadonlySet<string> = new Set()): string[] => {
  const kept: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] as string;
    const lower = name.toLowerCase();
    if (!HOP.has(lower) && !also.has(lower)) kept.push(name, raw[i + 1] as string);
  }
  return kept;
};

/**
 * The header naming the client to pdf-export, whose share of the waiting
 * reports trusts it. Always this gateway's, whatever the request sent: one a
 * client could choose would let it dodge that share by naming another.
 */
const CLIENT_HEADER = 'X-Reactome-Client';
const CLIENT_NAMED = new Set([CLIENT_HEADER.toLowerCase()]);

/**
 * Who a request is from, for the per-client share: the address nginx saw
 * (X-Real-IP, which it sets from the connection; the gateway listens on
 * loopback, so only nginx can send it), else the connection's own. An IPv6
 * client holds a /64 and can choose any address in it, so it is that /64.
 */
export function clientOf(req: IncomingMessage): string {
  const header = req.headers['x-real-ip'];
  const address = (typeof header === 'string' && header.trim()) || req.socket.remoteAddress || '';
  if (!address.includes(':') || address.startsWith('::ffff:')) return address;
  const [head = '', tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/**
 * pdf-export cannot be reached: 503 in the analysis service's form, as
 * pdf-export writes its own 503 (its spec 002, FR-203), so the report's
 * address keeps one error format; not the 502 for the AnalysisService.
 */
function reportUnreachable(res: ServerResponse, retryAfter: number): void {
  if (res.headersSent || res.destroyed) return;
  const body = `${JSON.stringify({
    code: 503,
    reason: 'Service Unavailable',
    messages: [`The report service cannot be reached; try again in ${retryAfter} seconds`],
  })}\n`;
  res.writeHead(503, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': String(Buffer.byteLength(body)),
    'Retry-After': String(retryAfter),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

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
  reportUpstream = 'http://127.0.0.1:4370',
  limits = { analysis: 4 },
  queueLength = 40,
  maxWaitMs = 60_000,
  perClient = 8,
  retryAfter = 10,
  waitingBytes = 256 * 1024 * 1024,
  upstreamTimeoutMs = 300_000,
}: GatewaySettings = {}) {
  const target = new URL(upstream);
  const reportTarget = new URL(reportUpstream);
  const analysis: Lane = { limit: limits.analysis, active: 0, waiting: [] };
  /** Reports passed to pdf-export and not yet answered. */
  let reports = 0;
  const counts = { passed: 0, admitted: 0, waited: 0, refused: 0, left: 0, failed: 0 };
  let held = 0;
  /** Each client's computations running or waiting, in all lanes. */
  const inside = new Map<string, number>();
  /** A place for `client`, and the call that gives it back (once). */
  function enter(client: string): () => void {
    inside.set(client, (inside.get(client) ?? 0) + 1);
    let given = false;
    return () => {
      if (given) return;
      given = true;
      const left = (inside.get(client) ?? 1) - 1;
      if (left > 0) inside.set(client, left);
      else inside.delete(client);
    };
  }

  /**
   * Send the request on, and its answer back as it came; `done` once the
   * service has finished with it. `body` is what was read while it waited,
   * if anything: the rest still comes from `req`. `report` sends it to
   * pdf-export instead, naming the client.
   */
  function pass(
    req: IncomingMessage,
    res: ServerResponse,
    {
      done = () => {},
      body,
      report,
    }: { done?: () => void; body?: HeldBody; report?: { client: string } } = {}
  ): void {
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      done();
    };
    const to = report ? reportTarget : target;
    const call = httpRequest(
      {
        host: to.hostname,
        port: to.port,
        method: req.method,
        path: req.url,
        headers: report
          ? [...without(req.rawHeaders, CLIENT_NAMED), CLIENT_HEADER, report.client]
          : without(req.rawHeaders),
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
    /** A report's reader who left before its answer was whole. */
    let abandoned = false;
    call.on('error', () => {
      if (abandoned) {
        counts.left++;
        finish();
        return;
      }
      counts.failed++;
      if (report) {
        if (!res.headersSent && !res.destroyed) reportUnreachable(res, retryAfter);
        else res.destroy();
      } else if (!res.headersSent && !res.destroyed) {
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
    if (report) {
      // A reader who leaves a report: pdf-export goes on making it for the
      // next request (its research R7), so only the wait ends here, and with
      // it the client's place, rather than holding both for the 30 s
      // pdf-export would hold a request nobody reads.
      res.on('close', () => {
        if (res.writableFinished) return;
        abandoned = true;
        call.destroy();
      });
      call.on('close', finish);
    }
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

  function admit(
    lane: Lane,
    req: IncomingMessage,
    res: ServerResponse,
    out: () => void,
    body?: HeldBody
  ): void {
    lane.active++;
    counts.admitted++;
    pass(req, res, {
      ...(body && { body }),
      done: () => {
        out();
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
      admit(lane, entry.req, entry.res, entry.out, entry.body);
    }
  }

  function wait(lane: Lane, req: IncomingMessage, res: ServerResponse, out: () => void): void {
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
      out,
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
      out();
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
        lanes: { analysis: state(analysis) },
        reports: { upstream: reportTarget.origin, active: reports },
        queueLength,
        maxWaitMs,
        perClient,
        clients: inside.size,
        heldBytes: held,
        ...counts,
      };
      res.end(JSON.stringify(health));
      return;
    }
    const name = classify(req.method, req.url);
    if (name === 'report') {
      // Never queued: pdf-export holds the request while it makes the
      // report, and has its own limits. The share still counts it, and a
      // client past its share is refused rather than made to wait.
      const client = clientOf(req);
      if ((inside.get(client) ?? 0) >= perClient) {
        counts.refused++;
        busy(res, retryAfter);
        return;
      }
      const out = enter(client);
      reports++;
      counts.admitted++;
      pass(req, res, {
        report: { client },
        done: () => {
          out();
          reports--;
        },
      });
      return;
    }
    const lane = name === 'analysis' ? analysis : undefined;
    if (!lane) {
      counts.passed++;
      pass(req, res);
      return;
    }
    const client = clientOf(req);
    if (lane.active < lane.limit) {
      admit(lane, req, res, enter(client));
      return;
    }
    // No one client takes every place: without a share, one address keeping
    // the lane and its waiting list full had everyone else refused. Only
    // when places are scarce -- a class behind one address, with the service
    // otherwise idle, still runs.
    if ((inside.get(client) ?? 0) >= perClient || lane.waiting.length >= queueLength) {
      counts.refused++;
      busy(res, retryAfter);
      return;
    }
    wait(lane, req, res, enter(client));
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
    reportUpstream: env['REPORT_UPSTREAM'] || 'http://127.0.0.1:4370',
    limits: { analysis: number('ANALYSIS_LIMIT', 4) },
    queueLength: number('QUEUE_LENGTH', 40),
    maxWaitMs: number('MAX_WAIT_MS', 60_000),
    perClient: number('PER_CLIENT', 8),
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
