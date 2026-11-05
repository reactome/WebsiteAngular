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
 * with an empty cache (a cached figure would compare a figure with itself),
 * `RENDER_FILES` mounted from `--files` and concurrency 1, and stopped after.
 * `--code` mounts a checkout's render service over the image's (its
 * `tools/render`), to compare code the image was not built from.
 *
 *  - `--mode reuse` (the default): the sample drawn fresh (`RENDER_REUSE=off`),
 *    then reused (`RENDER_REUSE=on`) in three orders -- as listed, reversed,
 *    and each request after its opposites -- each compared with the fresh run.
 *  - `--mode fresh`: the sample drawn fresh twice, compared (T011).
 *
 * The sample is one service path per line (`/render/R-HSA-….svg?dark=true`);
 * `#` starts a comment. SVG must match byte for byte; the other formats after
 * what varies by itself is set aside (`normalise`). A difference names the
 * request and the request drawn before it in that run. Exits 1 on any
 * difference or failed request.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

/** One drawn request: what came back, and what was drawn just before it. */
export interface Drawn {
  path: string;
  previous: string | undefined;
  status: number;
  bytes: Buffer;
}

/** A request whose answer is not the reference's. */
export interface Difference {
  run: string;
  path: string;
  previous: string | undefined;
  why: string;
}

/** The sample's request paths, from its text: one per line, `#` comments. */
export function parseSample(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
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

/**
 * The requests a request is drawn after in the third order: each one the
 * request's opposite in one setting, so a held page that kept that setting
 * would draw this request wrong. Dark against light, either way; a token
 * against none, either way (`token` is the sample's own, if it has one); a
 * selection against none; the overview of one species against another's.
 */
export function opposites(request: string, token: string | undefined): string[] {
  const query = new URLSearchParams(request.split('?')[1] ?? '');
  const genomeWide = request.startsWith('/render/genome-wide.');
  const found: string[] = [
    withQuery(request, (q) =>
      q.get('dark') === 'true' ? q.delete('dark') : q.set('dark', 'true')
    ),
  ];
  if (query.has('token')) found.push(withQuery(request, (q) => q.delete('token')));
  else if (token) found.push(withQuery(request, (q) => q.set('token', token)));
  if (query.has('select')) found.push(withQuery(request, (q) => q.delete('select')));
  if (genomeWide)
    found.push(
      withQuery(request, (q) =>
        q.get('species') === '10090' ? q.delete('species') : q.set('species', '10090')
      )
    );
  return found;
}

/** The three orders of research R5: as listed, reversed, and each request after its opposites. */
export function orders(sample: string[]): {
  listed: string[];
  reversed: string[];
  opposites: string[];
} {
  const token = sample
    .map((request) => new URLSearchParams(request.split('?')[1] ?? '').get('token'))
    .find((value): value is string => Boolean(value));
  return {
    listed: [...sample],
    reversed: [...sample].reverse(),
    opposites: sample.flatMap((request) => [...opposites(request, token), request]),
  };
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

/** PowerPoint: a zip whose entries carry their write times; its entries' names and contents. */
function normalisePptx(bytes: Buffer): Buffer {
  const entries = unzipSync(new Uint8Array(bytes));
  const parts = Object.keys(entries)
    .sort()
    .flatMap((name) => [Buffer.from(`${name}\n`), Buffer.from(entries[name] ?? new Uint8Array())]);
  return Buffer.concat(parts);
}

/**
 * A figure with what varies by itself set aside (research R5): SVG, PNG,
 * JPEG and GIF as they are; a PDF's dates and id; a PowerPoint's zip times.
 */
export function normalise(format: string, bytes: Buffer): Buffer {
  if (format === 'pdf') return normalisePdf(bytes);
  if (format === 'pptx') return normalisePptx(bytes);
  return bytes;
}

/**
 * Each drawn request against the reference run's answer to it, after
 * normalising. A request the reference does not hold (an opposite drawn only
 * to precede another) is not compared; a failed request is a difference.
 */
export function compare(run: string, reference: Map<string, Drawn>, drawn: Drawn[]): Difference[] {
  const found: Difference[] = [];
  for (const item of drawn) {
    const expected = reference.get(item.path);
    if (!expected) {
      if (item.status !== 200)
        found.push({ run, path: item.path, previous: item.previous, why: `status ${item.status}` });
      continue;
    }
    if (item.status !== expected.status) {
      found.push({
        run,
        path: item.path,
        previous: item.previous,
        why: `status ${item.status}, the reference's ${expected.status}`,
      });
      continue;
    }
    const format = formatOf(item.path);
    if (!normalise(format, item.bytes).equals(normalise(format, expected.bytes)))
      found.push({ run, path: item.path, previous: item.previous, why: `${format} differs` });
  }
  return found;
}

/** Draw requests one at a time, in order, each with the one drawn before it. */
export async function draw(
  service: string,
  requests: string[],
  get: (url: string) => Promise<{ status: number; bytes: Buffer }> = fetchBytes
): Promise<Drawn[]> {
  const drawn: Drawn[] = [];
  let previous: string | undefined;
  for (const request of requests) {
    const { status, bytes } = await get(service + request);
    drawn.push({ path: request, previous, status, bytes });
    previous = request;
  }
  return drawn;
}

async function fetchBytes(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
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

/** One service run: a container from `image`, empty cache, the release files, concurrency 1. */
async function withService<T>(
  options: {
    image: string;
    base: string;
    files: string;
    code: string | undefined;
    reuse: boolean;
    port: number;
  },
  use: (service: string) => Promise<T>
): Promise<T> {
  const name = `reuse-compare-${process.pid}-${options.port}`;
  const started = spawnSync('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-p',
    `127.0.0.1:${options.port}:4310`,
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
  const service = `http://127.0.0.1:${options.port}`;
  try {
    let health: { files?: string } | undefined;
    for (let attempt = 0; attempt < 60 && !health; attempt += 1) {
      try {
        health = (await (await fetch(`${service}/health`)).json()) as { files?: string };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    // Never a bulk run against the download site.
    if (health?.files !== 'local') throw new Error(`${service} does not read local files`);
    return await use(service);
  } finally {
    spawnSync('docker', ['rm', '-f', name]);
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
  console.log(`${sample.length} requests, mode ${mode}`);

  const run = (reuse: boolean, requests: string[]) =>
    withService({ ...options, reuse, port: 4390 }, (service) => draw(service, requests));

  const reference = new Map((await run(false, sample)).map((item) => [item.path, item]));
  const failed = [...reference.values()].filter((item) => item.status !== 200);
  const differences: Difference[] = failed.map((item) => ({
    run: 'fresh',
    path: item.path,
    previous: item.previous,
    why: `status ${item.status}`,
  }));
  const runs =
    mode === 'fresh' ? { 'fresh again': sample } : (orders(sample) as Record<string, string[]>);
  for (const [label, requests] of Object.entries(runs)) {
    const drawn = await run(mode !== 'fresh', requests);
    const found = compare(label, reference, drawn);
    console.log(`${label}: ${requests.length} drawn, ${found.length} differ`);
    differences.push(...found);
  }
  for (const item of differences)
    console.log(`  ${item.run}: ${item.path} (after ${item.previous ?? 'nothing'}): ${item.why}`);
  const out = flag('out');
  if (out)
    writeFileSync(out, JSON.stringify({ mode, requests: sample.length, differences }, null, 2));
  process.exit(differences.length ? 1 : 0);
}

// Run only as a script: the tests import the functions above.
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname)
  await main();
