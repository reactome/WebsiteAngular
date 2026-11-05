/**
 * Spec 018 T002 (research R5): draw a sample through render services and
 * compare what comes back, so a held page is shown to draw what a fresh page
 * draws.
 *
 *   node tools/render/reuse-compare.ts --sample sample.txt --files <release files>
 *        [--base http://172.17.0.1:4200] [--image websiteangular-render:latest]
 *        [--code tools/render] [--mode reuse|fresh] [--out report.json]
 *
 * Each run is its own service, started here as a container from `--image`
 * with an empty cache, `RENDER_FILES` mounted from `--files` and concurrency
 * 1, and removed after (or on Ctrl-C). `--code` mounts a checkout's render
 * service over the image's (its `tools/render`), to compare code the image
 * was not built from.
 *
 *  - `--mode reuse` (the default): the sample drawn fresh (`RENDER_REUSE=off`),
 *    then reused (`RENDER_REUSE=on`) as listed, reversed, and in pairs -- each
 *    request straight after one of its opposites -- each compared with the
 *    fresh run. The service's `/health` must say it holds pages, or a "reused"
 *    run would be fresh and pass without testing anything.
 *  - `--mode fresh`: the sample drawn fresh twice, compared (T011).
 *
 * Every figure must be drawn, never served from the service's cache: no run
 * asks for the same request twice (the pairs are spread over as many runs as
 * that takes), and a cache hit is a difference.
 *
 * The sample is one service path per line (`/render/R-HSA-109581.svg?dark=true`);
 * `#` starts a comment, and a repeated request is drawn once. SVG must match
 * byte for byte; the other formats after what varies by itself is set aside
 * (`normalise`). A difference names the request and the request drawn just
 * before it. Exits 1 on any difference or failed request.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { isEntry } from '../../scripts/is-entry.mjs';

/** One drawn request: what came back, and what was drawn just before it. */
export interface Drawn {
  path: string;
  previous: string | undefined;
  status: number;
  /** The service's X-Render-Cache: `hit` means it was not drawn. */
  cache: string;
  bytes: Buffer;
}

/** A request whose answer is not the reference's. */
export interface Difference {
  run: string;
  path: string;
  previous: string | undefined;
  why: string;
}

/**
 * A parameter at the value the service takes when it is left out
 * (service.ts): `dark=false`, `subpathways=true`, `scale=2`, `delay=1000`,
 * `maxSize=0` -- numbers compared as numbers -- or empty where the service
 * takes an empty value as none.
 */
const DEFAULTS: Record<string, string> = {
  dark: 'false',
  subpathways: 'true',
  scale: '2',
  delay: '1000',
  maxSize: '0',
};
/** Parameters the service reads as numbers (Number, then clamp): compared as numbers. */
const NUMERIC = new Set(['scale', 'delay', 'maxSize']);
/** Parameters whose empty value the service takes as none; any other empty value it refuses. */
const EMPTY_IS_NONE = new Set(['token', 'select', 'highlight', 'maxSize']);
const isDefault = (name: string, value: string) =>
  value === ''
    ? EMPTY_IS_NONE.has(name)
    : NUMERIC.has(name)
      ? Number(value) === Number(DEFAULTS[name])
      : DEFAULTS[name] === value;
/** A value as the service reads it: a number in its plain form. */
const normal = (name: string, value: string) =>
  NUMERIC.has(name) && value !== '' && Number.isFinite(Number(value))
    ? String(Number(value))
    : value;

/**
 * One figure however it is written: its path and its parameters decoded and
 * sorted, a parameter at its default as none. The service's cache key is
 * built from the parsed parameters, so two spellings of one figure are one
 * cache entry.
 */
export function canonical(request: string): string {
  const [path = '', query = ''] = request.split('?');
  // The service reads the extension in lower case and draws a .jpg as a
  // JPEG: one cache entry with .jpeg.
  const figure = path
    .replace(/\.[A-Za-z]+$/, (extension) => extension.toLowerCase())
    .replace(/\.jpg$/, '.jpeg');
  const params = [...new URLSearchParams(query)]
    .filter(([name, value]) => !isDefault(name, value))
    .map(([name, value]): [string, string] => [name, normal(name, value)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  return `${figure}?${params.map(([name, value]) => `${name}=${value}`).join('&')}`;
}

/** The sample's request paths, from its text: one per line, `#` comments, each figure once. */
export function parseSample(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((request) => {
      if (!request || seen.has(canonical(request))) return false;
      seen.add(canonical(request));
      return true;
    });
}

/** A request path's format, from its extension. */
export function formatOf(request: string): string {
  return /\.([a-z]+)(\?|$)/.exec(request)?.[1] ?? 'svg';
}

function withQuery(request: string, change: (query: URLSearchParams) => void): string {
  const [pathPart = '', query = ''] = request.split('?');
  const params = new URLSearchParams(query);
  change(params);
  const text = params.toString();
  return text ? `${pathPart}?${text}` : pathPart;
}

const queryOf = (request: string) => new URLSearchParams(request.split('?')[1] ?? '');

/**
 * Which of the sample's species overviews goes before `request`: one,
 * chosen by the figure's text so a run is repeatable. pairRuns' cap keeps
 * the runs bounded; every figure being offered one keeps a small sample
 * covered.
 */
function overviewBefore(request: string, overviews: string[]): string | undefined {
  let hash = 0;
  for (const character of canonical(request)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return overviews[hash % overviews.length];
}

/**
 * The requests that may come straight before `request` in a pair: each one a
 * held page could carry a setting over from, drawing `request` wrong (spec
 * 018 FR-004, research R5):
 * - dark against light, either way;
 * - a token against none, either way (`token` is the sample's own, if it has
 *   one), and against each of the sample's other tokens;
 * - a selection, a highlight, or subpathways off, against none, either way:
 *   the sample's own on the same figure, or the figure without it;
 * - the overview of one species against another's, and the sample's species
 *   overviews, one before each figure (overviewBefore; pairRuns caps them).
 */
export function opposites(request: string, sample: string[], token: string | undefined): string[] {
  const query = queryOf(request);
  const figure = request.split('?')[0] ?? '';
  const found: string[] = [
    withQuery(request, (q) =>
      q.get('dark') === 'true' ? q.delete('dark') : q.set('dark', 'true')
    ),
  ];
  if (query.has('token')) found.push(withQuery(request, (q) => q.delete('token')));
  else if (token) found.push(withQuery(request, (q) => q.set('token', token)));
  const own = query.get('token');
  const tokens = new Set(sample.map((other) => queryOf(other).get('token')).filter(Boolean));
  // Two of them: every token before every other token's figures grew the
  // runs with the number of tokens.
  if (own)
    for (const other of [...tokens].filter((other) => other && other !== own).slice(0, 2))
      found.push(withQuery(request, (q) => q.set('token', other as string)));
  // A setting the figure has, or the sample's own figures with it.
  for (const name of ['select', 'highlight', 'subpathways']) {
    if (query.has(name)) found.push(withQuery(request, (q) => q.delete(name)));
    else
      // Two of them: a figure goes second once per run, so all forty
      // highlights on one diagram before the diagram made forty runs.
      found.push(
        ...sample
          .filter((other) => other.split('?')[0] === figure && queryOf(other).has(name))
          .slice(0, 2)
      );
  }
  if (request.startsWith('/render/genome-wide.'))
    found.push(
      withQuery(request, (q) =>
        q.get('species') === '10090' ? q.delete('species') : q.set('species', '10090')
      )
    );
  else {
    const overview = overviewBefore(
      request,
      sample.filter(
        (other) => other.startsWith('/render/genome-wide.') && queryOf(other).has('species')
      )
    );
    if (overview) found.push(overview);
  }
  return [...new Set(found)].filter((other) => canonical(other) !== canonical(request));
}

/**
 * The pairs any one request may go first in: enough that each kind of
 * leftover is shown before a few different figures, few enough that the runs
 * stay bounded however large the sample.
 */
const OPPOSITE_USES = 3;

/**
 * Pairs -- an opposite, then the request -- spread over runs so that no run
 * asks for anything twice: a second ask would be served from the cache.
 */
export function pairRuns(sample: string[]): string[][] {
  const token = sample.map((request) => queryOf(request).get('token')).find(Boolean) ?? undefined;
  const runs: { requests: string[]; asked: Set<string> }[] = [];
  // How often each request has gone first: at most OPPOSITE_USES times, so one
  // request that is everyone's opposite -- a species overview, a bare diagram
  // under many highlights -- cannot make a run per figure.
  const used = new Map<string, number>();
  for (const request of sample)
    for (const opposite of opposites(request, sample, token)) {
      const [first, second] = [canonical(opposite), canonical(request)];
      if ((used.get(first) ?? 0) >= OPPOSITE_USES) continue;
      used.set(first, (used.get(first) ?? 0) + 1);
      let run = runs.find(({ asked }) => !asked.has(first) && !asked.has(second));
      if (!run) {
        run = { requests: [], asked: new Set() };
        runs.push(run);
      }
      run.requests.push(opposite, request);
      run.asked.add(first).add(second);
    }
  return runs.map(({ requests }) => requests);
}

/** The runs of research R5 for a reused service: as listed, reversed, and the pairs. */
export function orders(sample: string[]): Record<string, string[]> {
  const runs: Record<string, string[]> = {
    listed: [...sample],
    reversed: [...sample].reverse(),
  };
  pairRuns(sample).forEach((requests, index) => {
    runs[`pairs ${index + 1}`] = requests;
  });
  return runs;
}

/** PDF: the creation and modification dates and the file id, which every draw sets anew. */
function normalisePdf(bytes: Buffer): Buffer {
  return Buffer.from(
    bytes
      .toString('latin1')
      .replace(/\/(CreationDate|ModDate) ?\(D:[^)]*\)/g, '/$1 ()')
      .replace(/\/ID ?\[ ?<[0-9A-Fa-f]*> ?<[0-9A-Fa-f]*> ?\]/g, '/ID []'),
    'latin1'
  );
}

/**
 * PowerPoint: a zip whose entries carry their write times. Compared by its
 * parts -- each name and content, with their lengths -- so the zip's own
 * bookkeeping (times, order, compression) is set aside, and only that.
 */
function normalisePptx(bytes: Buffer): Buffer {
  const entries = unzipSync(new Uint8Array(bytes));
  const parts = Object.keys(entries)
    .sort()
    .flatMap((name) => {
      const content = Buffer.from(entries[name] ?? new Uint8Array());
      return [Buffer.from(`${name}\n${content.length}\n`), content];
    });
  return Buffer.concat(parts);
}

/**
 * A figure with what varies by itself set aside (research R5): SVG, PNG,
 * JPEG and GIF as they are; a PDF's dates and id; a PowerPoint's zip.
 */
export function normalise(format: string, bytes: Buffer): Buffer {
  if (format === 'pdf') return normalisePdf(bytes);
  if (format === 'pptx') return normalisePptx(bytes);
  return bytes;
}

/**
 * Each drawn request against the reference run's answer to it, after
 * normalising. A cache hit or a failure is a difference wherever it is; a
 * request the reference does not hold (an opposite, there only to come
 * first) is otherwise not compared.
 */
export function compare(run: string, reference: Map<string, Drawn>, drawn: Drawn[]): Difference[] {
  const found: Difference[] = [];
  const differs = (item: Drawn, why: string) =>
    found.push({ run, path: item.path, previous: item.previous, why });
  for (const item of drawn) {
    if (item.cache === 'hit') {
      differs(item, 'served from the cache, not drawn');
      continue;
    }
    const expected = reference.get(item.path);
    if (!expected) {
      if (item.status !== 200) differs(item, `status ${item.status}`);
      continue;
    }
    if (item.status !== expected.status) {
      differs(item, `status ${item.status}, the reference's ${expected.status}`);
      continue;
    }
    const format = formatOf(item.path);
    if (!normalise(format, item.bytes).equals(normalise(format, expected.bytes)))
      differs(item, `${format} differs`);
  }
  return found;
}

/**
 * Draw requests one at a time, in order, each with the one before it. A
 * request that fails to answer (a timeout, a dropped connection) is status 0,
 * a difference, and the run goes on.
 */
export async function draw(
  service: string,
  requests: string[],
  get: (url: string) => Promise<{ status: number; cache: string; bytes: Buffer }> = fetchBytes
): Promise<Drawn[]> {
  const drawn: Drawn[] = [];
  let previous: string | undefined;
  for (const request of requests) {
    const answer = await get(service + request).catch(() => ({
      status: 0,
      cache: '',
      bytes: Buffer.alloc(0),
    }));
    drawn.push({ path: request, previous, ...answer });
    previous = request;
  }
  return drawn;
}

async function fetchBytes(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  return {
    status: response.status,
    cache: response.headers.get('x-render-cache') ?? '',
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

/**
 * Whether a reused run drew on held pages throughout: at concurrency 1 the
 * first draw makes the page and every later one reuses it. A page closed and
 * replaced part-way (past its memory bound, say) puts the pair across the
 * change on two pages, testing nothing, so the run is not a test. Undefined
 * when it was one.
 */
export function heldProblem(reused: unknown, drawn: number): string | undefined {
  if (reused === drawn - 1) return undefined;
  return `${drawn - 1 - Number(reused ?? 0)} of ${drawn} draws were not on a held page (/health reused ${String(reused)})`;
}

/** What a run's service must say of itself: local files, and reuse as asked. Undefined when it does. */
export function healthProblem(
  health: { files?: unknown; reuse?: unknown } | undefined,
  reuse: boolean
): string | undefined {
  if (!health) return 'never answered /health';
  // Never a bulk run against the download site.
  if (health.files !== 'local') return 'does not read local files';
  if (reuse && health.reuse !== true) return 'does not hold pages (/health reuse is not true)';
  if (!reuse && health.reuse === true) return 'holds pages, for a fresh run';
  return undefined;
}

function flag(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

/** The image runs its service from /render/*.ts: a checkout's, each file mounted over its own. */
function codeMounts(code: string | undefined): string[] {
  if (!code) return [];
  return readdirSync(code)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
    .flatMap((file) => ['-v', `${path.resolve(code, file)}:/render/${file}:ro`]);
}

const PORT = 4390;
const NAME = `reuse-compare-${process.pid}`;
const removeService = () => spawnSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' });

/** One service run: a container from `image`, empty cache, the release files, concurrency 1. */
async function withService<T>(
  options: {
    image: string;
    base: string;
    files: string;
    code: string | undefined;
    reuse: boolean;
  },
  use: (service: string, health: Record<string, unknown>) => Promise<T>,
  after: (health: Record<string, unknown>) => void = () => {}
): Promise<T> {
  // No --rm: removed here, after its logs could be read, and before the next run.
  const started = spawnSync('docker', [
    'run',
    '-d',
    '--name',
    NAME,
    '-p',
    `127.0.0.1:${PORT}:4310`,
    '-v',
    `${path.resolve(options.files)}:/files:ro`,
    ...codeMounts(options.code),
    '-e',
    'RENDER_FILES=/files',
    '-e',
    `RENDER_BASE=${options.base}`,
    '-e',
    'RENDER_CONCURRENCY=1',
    '-e',
    'RENDER_TIMEOUT=180000',
    // No page is replaced for its count part-way through a run (heldProblem).
    '-e',
    'RENDER_REUSE_MAX=1000000',
    '-e',
    `RENDER_REUSE=${options.reuse ? 'on' : 'off'}`,
    '--shm-size',
    '1g',
    '--memory',
    '3g',
    '--memory-swap',
    '3g',
    options.image,
  ]);
  if (started.status !== 0) {
    // A container docker made but could not start (its port taken, say).
    removeService();
    throw new Error(`docker run failed: ${started.stderr.toString()}`);
  }
  const service = `http://127.0.0.1:${PORT}`;
  try {
    let health: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 60 && !health; attempt += 1) {
      try {
        const response = await fetch(`${service}/health`, { signal: AbortSignal.timeout(5000) });
        health = (await response.json()) as Record<string, unknown>;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    const problem = healthProblem(health, options.reuse);
    if (problem) {
      const logs = spawnSync('docker', ['logs', '--tail', '20', NAME]).stdout.toString();
      throw new Error(`${service} ${problem}\n${logs}`);
    }
    const result = await use(service, health ?? {});
    after(
      (await fetch(`${service}/health`, { signal: AbortSignal.timeout(5000) })
        .then((response) => response.json())
        .catch(() => ({}))) as Record<string, unknown>
    );
    return result;
  } finally {
    removeService();
  }
}

async function main() {
  const samplePath = flag('sample');
  const files = flag('files');
  if (!samplePath || !files) {
    console.error(
      'usage: reuse-compare.ts --sample <file> --files <release files> [--mode reuse|fresh]'
    );
    process.exit(2);
  }
  const mode = flag('mode', 'reuse');
  const options = {
    image: flag('image', 'websiteangular-render:latest') as string,
    base: flag('base', 'http://172.17.0.1:4200') as string,
    files,
    code: flag('code'),
  };
  const sample = parseSample(readFileSync(samplePath, 'utf8'));
  // A sample of nothing would draw nothing and find no difference: not a test.
  if (!sample.length) {
    console.error(`${samplePath} holds no requests`);
    process.exit(2);
  }
  console.log(`${sample.length} requests, mode ${mode}`);

  const builds: Record<string, unknown> = {};
  const differences: Difference[] = [];
  // What was found so far is printed and written however the run ends.
  const finish = (code: number, stopped?: string) => {
    for (const item of differences)
      console.log(`  ${item.run}: ${item.path} (after ${item.previous ?? 'nothing'}): ${item.why}`);
    if (stopped) console.log(`stopped: ${stopped}`);
    const out = flag('out');
    if (out)
      writeFileSync(
        out,
        JSON.stringify(
          { mode, ...options, builds, requests: sample.length, stopped, differences },
          null,
          2
        )
      );
    process.exit(code);
  };
  // A container left behind holds memory on a shared host -- also when the
  // terminal or session that started the run goes away (SIGHUP). That stops a
  // run started under nohup too: start a long run in tmux or screen instead.
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)
    process.on(signal, () => {
      removeService();
      finish(code, signal);
    });

  const run = (label: string, reuse: boolean, requests: string[]) =>
    withService(
      { ...options, reuse },
      (service, health) => {
        builds[label] = health['build'];
        return draw(service, requests);
      },
      (health) => {
        const problem = reuse ? heldProblem(health['reused'], requests.length) : undefined;
        if (problem) differences.push({ run: label, path: '', previous: undefined, why: problem });
      }
    );

  try {
    const fresh = await run('fresh', false, sample);
    const reference = new Map(fresh.map((item) => [item.path, item]));
    // The reference itself: a failure or a cache hit there is a difference too.
    differences.push(...compare('fresh', new Map(), fresh));
    const runs = mode === 'fresh' ? { 'fresh again': sample } : orders(sample);
    for (const [label, requests] of Object.entries(runs)) {
      const drawn = await run(label, mode !== 'fresh', requests);
      const found = compare(label, reference, drawn);
      console.log(`${label}: ${requests.length} drawn, ${found.length} differ`);
      differences.push(...found);
    }
  } catch (error) {
    finish(1, error instanceof Error ? error.message : String(error));
  }
  finish(differences.length ? 1 : 0);
}

if (isEntry(import.meta.url)) await main();
