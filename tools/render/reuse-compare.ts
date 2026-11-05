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

/** The sample's request paths, from its text: one per line, `#` comments, each once. */
export function parseSample(text: string): string[] {
  const requests = text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
  return [...new Set(requests)];
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
 * The requests that may come straight before `request` in a pair: each its
 * opposite in one setting, so a held page that kept that setting would draw
 * `request` wrong. Dark against light, either way; a token against none,
 * either way (`token` is the sample's own, if it has one); a selection against
 * none, either way (the sample's own selections on the same diagram); the
 * overview of one species against another's.
 */
export function opposites(request: string, sample: string[], token: string | undefined): string[] {
  const query = queryOf(request);
  const found: string[] = [
    withQuery(request, (q) =>
      q.get('dark') === 'true' ? q.delete('dark') : q.set('dark', 'true')
    ),
  ];
  if (query.has('token')) found.push(withQuery(request, (q) => q.delete('token')));
  else if (token) found.push(withQuery(request, (q) => q.set('token', token)));
  if (query.has('select')) found.push(withQuery(request, (q) => q.delete('select')));
  else {
    const figure = request.split('?')[0];
    found.push(
      ...sample.filter((other) => other.split('?')[0] === figure && queryOf(other).has('select'))
    );
  }
  if (request.startsWith('/render/genome-wide.'))
    found.push(
      withQuery(request, (q) =>
        q.get('species') === '10090' ? q.delete('species') : q.set('species', '10090')
      )
    );
  return found;
}

/**
 * Pairs -- an opposite, then the request -- spread over runs so that no run
 * asks for anything twice: a second ask would be served from the cache.
 */
export function pairRuns(sample: string[]): string[][] {
  const token = sample.map((request) => queryOf(request).get('token')).find(Boolean) ?? undefined;
  const runs: { requests: string[]; asked: Set<string> }[] = [];
  for (const request of sample)
    for (const opposite of opposites(request, sample, token)) {
      let run = runs.find(({ asked }) => !asked.has(opposite) && !asked.has(request));
      if (!run) {
        run = { requests: [], asked: new Set() };
        runs.push(run);
      }
      run.requests.push(opposite, request);
      run.asked.add(opposite).add(request);
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
  use: (service: string, health: Record<string, unknown>) => Promise<T>
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
  if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr.toString()}`);
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
    return await use(service, health ?? {});
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
  // A container left behind holds memory on a shared host.
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      removeService();
      process.exit(130);
    });
  const mode = flag('mode', 'reuse');
  const options = {
    image: flag('image', 'websiteangular-render:latest') as string,
    base: flag('base', 'http://172.17.0.1:4200') as string,
    files,
    code: flag('code'),
  };
  const sample = parseSample(readFileSync(samplePath, 'utf8'));
  console.log(`${sample.length} requests, mode ${mode}`);

  const builds: Record<string, unknown> = {};
  const run = (label: string, reuse: boolean, requests: string[]) =>
    withService({ ...options, reuse }, (service, health) => {
      builds[label] = health['build'];
      return draw(service, requests);
    });

  const fresh = await run('fresh', false, sample);
  const reference = new Map(fresh.map((item) => [item.path, item]));
  // The reference itself: a failure or a cache hit there is a difference too.
  const differences = compare('fresh', new Map(), fresh);
  const runs = mode === 'fresh' ? { 'fresh again': sample } : orders(sample);
  for (const [label, requests] of Object.entries(runs)) {
    const drawn = await run(label, mode !== 'fresh', requests);
    const found = compare(label, reference, drawn);
    console.log(`${label}: ${requests.length} drawn, ${found.length} differ`);
    differences.push(...found);
  }
  for (const item of differences)
    console.log(`  ${item.run}: ${item.path} (after ${item.previous ?? 'nothing'}): ${item.why}`);
  const out = flag('out');
  if (out)
    writeFileSync(
      out,
      JSON.stringify({ mode, ...options, builds, requests: sample.length, differences }, null, 2)
    );
  process.exit(differences.length ? 1 : 0);
}

if (isEntry(import.meta.url)) await main();
