#!/usr/bin/env node
/**
 * Renders pathway diagrams over HTTP, by driving the site's own render page.
 *
 * Replaces what the Java exporters do (diagram-exporter, reaction-exporter,
 * event-pdf) with the renderer the site actually uses, so a figure in a report
 * cannot drift from what a curator sees on screen.
 *
 * Three properties matter more than features here.
 *
 * It binds to loopback by default. A render costs seconds, so an anonymous
 * request must never be able to commission one -- crawling the old
 * /ContentService/exporter/* document endpoints exhausted Tomcat's heap and took
 * the origin down. Whatever fronts this decides who may cause work, and the
 * network is the strongest form of that decision.
 *
 * The cache is the point, not an optimisation. A diagram with no analysis token
 * is identical for a whole release, so nearly every request should be a file
 * read; rendering is what happens when the cache misses.
 *
 * It refuses work rather than queueing without limit. A saturated renderer that
 * answers 503 recovers; one holding a thousand pending jobs does not.
 *
 *   node tools/render/service.ts
 *   curl -o out.svg 'http://127.0.0.1:4310/render/R-HSA-73857.svg'
 *
 * Environment:
 *   RENDER_PORT         default 4310
 *   RENDER_HOST         default 127.0.0.1 -- set 0.0.0.0 only behind something
 *   RENDER_BASE         site to render against, default http://localhost:4200
 *   RENDER_CACHE        cache directory, default .render-cache
 *   RENDER_CACHE_KEY    salt; change it to invalidate everything (e.g. release)
 *   RENDER_CONCURRENCY  simultaneous renders, default 2
 *   RENDER_QUEUE        pending renders before 503, default 8
 *   RENDER_CACHE_MAX    bytes of cache to keep, default 2 GB (0 disables)
 *
 * Query parameters: token, scale, subpathways=false, dark=true, select=<stId>,
 * highlight=<stId>,<stId>...,
 * layout=reaction,
 * and delay and
 * maxSize for GIF.
 */
import express, { type Request, type Response } from 'express';
import {
  speciesProblem,
  ACCEPTED,
  BOUNDS,
  REACTION_CLASSES,
  badEnums,
  canonicalUrl,
  inBounds,
  repeated,
} from './params.ts';
import { chromium, type Browser } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  rename,
  readdir,
  unlink,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { FORMATS, render } from './render-core.ts';

const PORT = Number(process.env['RENDER_PORT'] || 4310);
const HOST = process.env['RENDER_HOST'] || '127.0.0.1';
const BASE = process.env['RENDER_BASE'] || 'http://localhost:4200';
const CACHE = process.env['RENDER_CACHE'] || path.resolve('.render-cache');
// Bump this whenever the renderer's output changes, not only when the data
// does: it keys the disk cache AND is the ETag, so it is the only thing that
// tells a browser its copy is stale. v2 = full-size differenced GIFs; v3 =
// illustrations export as standalone SVG, styles inlined and size written down;
// v4 = PowerPoint is shapes rather than a picture of them; v5 = arrowheads are
// geometry, so a hollow circle and an inhibition bar are no longer both drawn
// as a filled triangle; v6 = complexes, sets and genes carry the body their
// background image draws instead of coming out as empty rectangles; v7 = a
// framed export clips every shape, so an arrowhead no longer protrudes past the
// frame and a glyph the frame cuts is cut rather than squashed; v8 = an
// illustration is parsed as XML, so one with an XHTML gradient inside
// foreignObject (Circadian clock) is drawn whole instead of a blue square. That
// fix is in the app, not under tools/render, and changes this output all the same.
//
// v5 exists because v4 was already published and the exporter changed again --
// the second time in one day that a correct build served a stale file. If you
// changed anything under tools/render that affects output, this line is part of
// the change.
// v9: `layout=reaction` had not reached the page since #277, so every reaction
// figure cached under v8 is the pathway diagram around it, filed under the
// reaction's key. A correct render must not be answered from that.
// v10: a PowerPoint groups each entity's and each reaction's shapes (#299, in
// #442), so every .pptx cached under v9 is the ungrouped slide curators could
// not drag apart.
const CACHE_KEY = process.env['RENDER_CACHE_KEY'] || 'v10';
const CONCURRENCY = Number(process.env['RENDER_CONCURRENCY'] || 2);
// Generous next to a real render, which is 3-8s, but far short of the two
// minutes a page that never becomes ready would otherwise hold a browser for.
const RENDER_TIMEOUT = Number(process.env['RENDER_TIMEOUT'] || 45_000);
const MAX_QUEUE = Number(process.env['RENDER_QUEUE'] || 8);
/**
 * How much cache to keep, in bytes.
 *
 * A figure averages a couple of megabytes and there are thousands of diagrams
 * times five formats, so an unbounded cache is tens of gigabytes -- on a host
 * that also runs Tomcat, Neo4j and the site's own builds. Filling that disk
 * takes the site down, which is a far worse outcome than paying for a render
 * again, and this cache is pure derived data: everything in it can be rebuilt
 * from the pathway id.
 */
const MAX_CACHE = Number(process.env['RENDER_CACHE_MAX'] ?? 2 * 1024 ** 3);

const CONTENT_TYPE = {
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  gif: 'image/gif',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Formats a browser would not usefully display, so offer them as a download. */
const ATTACHMENT = new Set(['pptx']);

const stats = { served: 0, hits: 0, rendered: 0, failed: 0, rejected: 0, evicted: 0 };

/**
 * Keep a request's numbers inside what this box can draw.
 *
 * These arrive from a query string, and the service is reachable through the
 * site, so they are attacker-controlled: scale=50 asks for a canvas of a few
 * hundred million pixels, which is an out-of-memory kill rather than an error.
 * Clamped rather than rejected -- a number slightly out of range is a caller
 * being optimistic, not a caller being wrong.
 */
function clamp(value, low, high, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

// ---- browser -------------------------------------------------------------
// One browser for the process, a fresh page per render. Reusing a page leaks
// state between renders -- a stale analysis token being the obvious one -- and a
// page is cheap next to a browser.
let browser: Browser | undefined;
async function getBrowser() {
  if (!browser?.isConnected()) browser = await chromium.launch();
  return browser;
}

/** An error with the HTTP status it answers with. */
export function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** The status an error answers with: its own, or 500. */
export const statusOf = (error: unknown): number =>
  error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 500;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ---- queue ---------------------------------------------------------------
let active = 0;
const waiting: {
  job: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}[] = [];

function schedule<T>(job: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY && waiting.length >= MAX_QUEUE) {
    stats.rejected++;
    return Promise.reject(httpError(503, 'renderer saturated'));
  }
  return new Promise<T>((resolve, reject) => {
    waiting.push({ job, resolve: resolve as (value: unknown) => void, reject });
    pump();
  });
}

function pump() {
  while (active < CONCURRENCY) {
    const next = waiting.shift();
    if (!next) return;
    const { job, resolve, reject } = next;
    active++;
    job()
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

// ---- cache ---------------------------------------------------------------
function cacheKey({
  pathway,
  format,
  token,
  scale,
  subpathways,
  delay,
  maxSize,
  dark,
  select,
  layout,
  highlight = '',
  species = '',
}) {
  // The token is part of the key rather than a reason not to cache: repeat
  // requests for the same analysis are exactly what a report generator makes.
  //
  // As JSON, not joined with spaces: joined, a highlight ending in a space and
  // a select starting with one gave the same key, so either figure could be
  // served for the other. Every key changed with it, once.
  return createHash('sha256')
    .update(
      JSON.stringify([
        CACHE_KEY,
        pathway,
        format,
        token,
        scale,
        subpathways,
        delay,
        maxSize,
        dark,
        select,
        layout,
        highlight,
        // Only when set, so every figure cached before it keeps its key.
        ...(species ? [species] : []),
      ])
    )
    .digest('hex');
}

async function fromCache(key, format) {
  const file = path.join(CACHE, `${key}.${format}`);
  try {
    await stat(file);
    const bytes = await readFile(file);
    // Mark it as used, so eviction drops what nobody asks for rather than what
    // happens to be oldest. relatime makes read atimes unreliable, so the
    // timestamp has to be set deliberately.
    const now = new Date();
    void utimes(file, now, now).catch(() => {});
    return bytes;
  } catch {
    return null;
  }
}

async function toCache(key, format, bytes) {
  await mkdir(CACHE, { recursive: true });
  // Write then rename, so a reader never sees a half-written file.
  const file = path.join(CACHE, `${key}.${format}`);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, file);
  await evict();
}

/**
 * Drop least-recently-used figures until the cache is back under its limit.
 *
 * Runs after a write, which is the only thing that grows it, and reads the
 * directory rather than tracking a running total -- the total has to survive
 * restarts and a cache directory shared with a previous run, and a readdir of a
 * few thousand entries costs less than one render.
 *
 * Evictions are logged. A cache that silently discards half of what it is asked
 * to keep looks exactly like a cache that is working.
 */
async function evict() {
  if (!MAX_CACHE) return;
  try {
    const names = await readdir(CACHE);
    const entries: { file: string; size: number; used: number }[] = [];
    let total = 0;
    for (const name of names) {
      if (name.endsWith('.tmp')) continue;
      const file = path.join(CACHE, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      entries.push({ file, size: info.size, used: info.mtimeMs });
      total += info.size;
    }
    if (total <= MAX_CACHE) return;

    // Down to 90%, not to exactly the limit, so the next write does not evict
    // again immediately.
    const target = MAX_CACHE * 0.9;
    entries.sort((a, b) => a.used - b.used);
    let removed = 0;
    let freed = 0;
    for (const entry of entries) {
      if (total <= target) break;
      if (
        await unlink(entry.file).then(
          () => true,
          () => false
        )
      ) {
        total -= entry.size;
        freed += entry.size;
        removed++;
      }
    }
    stats.evicted += removed;
    console.log(
      `evicted ${removed} cached figure(s), ${(freed / 1024 ** 2).toFixed(1)} MB, ` +
        `cache now ${(total / 1024 ** 2).toFixed(1)} MB of ` +
        `${(MAX_CACHE / 1024 ** 2).toFixed(0)} MB`
    );
  } catch (error) {
    // A cache that cannot be tidied is not a reason to fail a render.
    console.error(`could not evict from the cache: ${messageOf(error)}`);
  }
}

// ---- renders -------------------------------------------------------------
// A request for something already rendering waits for that render instead of
// starting its own. Without this, a report generator asking several workers for
// the same pathway pays for it several times.
const inFlight = new Map();

/**
 * Whether the id is something the backend knows about.
 *
 * Costs about a request, against a browser and a timeout. A render page asked
 * for an id that does not resolve simply never becomes ready, so without this
 * a typo occupies a render slot until it times out -- and ids arrive from URLs,
 * so typos are the normal case rather than the exceptional one.
 */
async function describe(pathway) {
  if (!pathway) return { known: true, schemaClass: '' }; // the genome-wide view takes no id
  try {
    const response = await fetch(`${BASE}/ContentService/data/query/${pathway}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { known: false, schemaClass: '' };
    // The class comes free: this request was already being made to find out
    // whether the id resolves, and it is what says whether `layout=reaction` can
    // mean anything for it.
    const body = await response.json().catch(() => ({}));
    return { known: true, schemaClass: String(body.schemaClass ?? '') };
  } catch {
    // If the check itself cannot run, let the render decide rather than
    // refusing work over a transient failure of something incidental. The class
    // is unknown rather than wrong, so a view check cannot be made either.
    return { known: true, schemaClass: '' };
  }
}

async function renderCached(params) {
  const key = cacheKey(params);

  const cached = await fromCache(key, params.format);
  if (cached) {
    stats.hits++;
    return { bytes: cached, cached: true };
  }

  if (inFlight.has(key)) {
    return { ...(await inFlight.get(key)), coalesced: true };
  }

  const { known, schemaClass } = await describe(params.pathway);
  if (!known) {
    throw httpError(404, `no such pathway: ${params.pathway}`);
  }
  // Checked here rather than at the edge of the handler because it is the same
  // request that establishes the id exists, and paying for it twice to refuse
  // slightly earlier would be a poor trade.
  if (params.layout === 'reaction' && schemaClass && !REACTION_CLASSES.has(schemaClass)) {
    throw httpError(
      400,
      `layout=reaction needs a reaction; ${params.pathway} is a ${schemaClass}. ` +
        'Ask for it without layout=reaction to draw the diagram it contains.'
    );
  }

  const work = schedule(async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1600, height: 1000 } });
    try {
      const started = Date.now();
      const { bytes, state, problems } = await render(page, {
        base: BASE,
        timeout: RENDER_TIMEOUT,
        ...params,
      });
      await toCache(key, params.format, bytes);
      stats.rendered++;
      const drew = [
        state.view,
        state.elements && `${state.elements} elements`,
        state.groups && `${state.groups} groups`,
        state.frames && `${state.frames} frames`,
      ]
        .filter(Boolean)
        .join(', ');
      console.log(
        `rendered ${params.pathway || 'genome-wide'}.${params.format} ` +
          `${bytes.length}b ${((Date.now() - started) / 1000).toFixed(1)}s [${drew}]` +
          (problems.length ? ` (${problems.length} browser problem(s))` : '')
      );
      return { bytes, cached: false };
    } finally {
      await page.close();
    }
  });

  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * A fingerprint of the code this process is actually running.
 *
 * The image bakes these modules in, so `docker compose build` is a separate act
 * from merging and nothing connected the two: a fix could be merged and not
 * deployed, or a container could be quietly ahead of main, and the only way to
 * tell was to read the source on disk -- which is the CLI's copy, not the
 * container's, and therefore always agrees with you.
 *
 * A content hash rather than a git sha, because a sha has to be passed in at
 * build time and anything that has to be remembered eventually is not. This
 * cannot be forgotten: it is computed from the files themselves. Compare it
 * against a checkout with
 *
 *   cat <dir>/*.ts | grep -v spec | sha256sum
 *
 * taking the files in the same order -- sorted by name, which is what readdir
 * is sorted into below.
 */
function buildId() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const names = readdirSync(here)
      // Specs excluded. They ship in the image -- the Dockerfile copies the
      // directory -- but they are not what the service does, and a fingerprint
      // that changes when a test is edited reports a deployment difference that
      // is not one. Caught by this very endpoint: adding service.spec.mjs moved
      // the hash without changing a line the service runs.
      .filter(isModule)
      .sort();
    const hash = createHash('sha256');
    for (const name of names) hash.update(readFileSync(path.join(here, name)));
    return { build: hash.digest('hex').slice(0, 12), modules: names.length };
  } catch {
    // Never fail a health check over its own metadata.
    return { build: 'unknown', modules: 0 };
  }
}

// ---- http ----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    ...buildId(),
    base: BASE,
    cache: CACHE,
    cacheKey: CACHE_KEY,
    active,
    waiting: waiting.length,
    ...stats,
  });
});

// "genome-wide" rather than an empty path segment, so the URL says what it is.
const renderRoute = async (req: Request<{ name: string; ext: string }>, res: Response) => {
  const { name, ext } = req.params;
  // `jpg` is the same picture under the name Java's enum also accepts, so a
  // caller moved from that endpoint keeps whichever spelling they already use.
  const format = ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase();
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: `unknown format "${format}"`, formats: FORMATS });
  }

  const twice = repeated(req.query);
  if (twice.length) {
    return res.status(400).json({
      error: `${twice.map((k) => `"${k}"`).join(', ')} given more than once`,
      canonical: canonicalUrl(name, format, req.query),
    });
  }

  const unknown = Object.keys(req.query).filter((key) => !ACCEPTED.includes(key));
  if (unknown.length) {
    return res.status(400).json({
      error: `unknown parameter${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => `"${u}"`).join(', ')}`,
      // Said rather than implied: a caller that has just been refused is the one
      // most likely to act on being told what to send instead.
      accepted: ACCEPTED,
      canonical: canonicalUrl(name, format, req.query),
    });
  }

  const badValues = badEnums(req.query);
  if (badValues.length) {
    return res.status(400).json({
      error: badValues.join('; '),
      canonical: canonicalUrl(name, format, req.query),
    });
  }

  const species = speciesProblem(name, req.query);
  if (species) {
    return res.status(400).json({
      error: species,
      // Without the species is the right URL for a pathway, which is its own
      // species. For the overview it would be the default species' -- a
      // figure of the wrong species, which is no suggestion at all.
      ...(name === 'genome-wide'
        ? {}
        : {
            canonical: canonicalUrl(
              name,
              format,
              Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== 'species'))
            ),
          }),
    });
  }

  // select frames the figure on one event; highlight marks events on the whole
  // diagram. Together they would draw a crop with some of it marked, which
  // neither caller asked for.
  if (req.query['select'] && req.query['highlight']) {
    return res.status(400).json({
      error: '"select" and "highlight" cannot be used together',
      canonical: canonicalUrl(
        name,
        format,
        Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== 'select'))
      ),
    });
  }

  const outOfRange = Object.keys(BOUNDS).filter(
    (key) => key in req.query && !inBounds(key, req.query[key])
  );
  if (outOfRange.length) {
    return res.status(400).json({
      error: outOfRange
        .map(
          (key) => `"${key}" must be a number between ${BOUNDS[key]?.[0]} and ${BOUNDS[key]?.[1]}`
        )
        .join('; '),
      // These used to be clamped silently, so `scale=4` returned a smaller image
      // than asked for with a 200. The ceiling is real -- a diagram's coordinate
      // space is around 6000px, so scale 4 asks for a 320-megapixel canvas, which
      // renders rather than failing and costs the box a gigabyte -- but a caller
      // who wants more detail deserves to hear that they cannot have it.
      canonical: canonicalUrl(name, format, req.query),
    });
  }

  const params = {
    pathway: name === 'genome-wide' ? '' : name,
    format,
    token: typeof req.query['token'] === 'string' ? req.query['token'] : '',
    // 2 is both the default and the ceiling. A diagram's own coordinate space
    // is around 6000px, so scale 4 asks for a 320-megapixel canvas -- it does
    // render, which is worse than failing: one query string costs the box a
    // gigabyte and nobody has needed more detail than the default.
    scale: clamp(req.query['scale'] ?? 2, 0.25, 2, 2),
    subpathways: req.query['subpathways'] !== 'false',
    dark: req.query['dark'] === 'true',
    // Frames the figure on one event: a reaction page asks for its own reaction,
    // not the diagram around it.
    select: typeof req.query['select'] === 'string' ? req.query['select'] : '',
    // Events marked as selected on the whole diagram, nothing framed: how Java's
    // exporter draws a subpathway (its reactions) or a reaction on the diagram
    // that holds it. Comma-separated stable ids, handed to the page as given.
    highlight: typeof req.query['highlight'] === 'string' ? req.query['highlight'] : '',
    // The only layout worth naming: everything else the page decides for itself
    // from the id it is given. `layout` all the way through: renamed from
    // `view` on one side only (#277), it never reached the page, and every
    // reaction figure came out as the whole pathway diagram around it.
    layout: req.query['layout'] === 'reaction' ? 'reaction' : '',
    // Whose overview the genome-wide view draws (speciesProblem has checked it).
    species: typeof req.query['species'] === 'string' ? req.query['species'] : '',
    delay: clamp(req.query['delay'] ?? 1000, 50, 10_000, 1000),
    // 0 means "the diagram's own size", which is where its labels are legible.
    maxSize: clamp(req.query['maxSize'] ?? 0, 0, 8000, 0),
  };

  // Everything that determines the bytes is in the key, so it is also the
  // validator -- and answering here means a repeat download costs a round trip
  // rather than a render.
  const etag = `"${cacheKey(params)}"`;
  if (req.headers['if-none-match'] === etag) {
    stats.served++;
    res.setHeader('ETag', etag);
    return res.status(304).end();
  }

  try {
    const { bytes, cached } = await renderCached(params);
    stats.served++;
    res.setHeader('Content-Type', CONTENT_TYPE[format]);
    res.setHeader('ETag', etag);
    res.setHeader('X-Render-Cache', cached ? 'hit' : 'miss');
    // Never reused without asking first. Not a performance decision: the
    // expensive part is already cached on disk here, so answering a conditional
    // request is a 304 and one round trip.
    //
    // Anything longer let a figure outlive the renderer that drew it. `public`
    // meant Cloudflare stored one and kept serving it with the max-age it was
    // stored under; Cloudflare's Browser Cache TTL overrode what this sends
    // anyway (300s went out as 4h); and a download link's URL is never
    // revalidated by reloading the page, so a curator kept getting a 2000px GIF
    // after the full-size fix had shipped. The alternative was stamping a
    // version into every figure's URL, which worked and which nobody should have
    // to remember to bump.
    res.setHeader('Cache-Control', 'private, no-cache');
    // A figure is public and read-only, and anyone can already ask for one
    // through the site -- CORS decides whether a *browser* may read the
    // response, not who may ask. Without it, a deployment served from a
    // different origin than its backend (the published artefact points at beta)
    // cannot fetch its own downloads, so the page can neither show progress nor
    // catch a failure. /ContentService already says the same thing.
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Only safelisted headers are readable cross-origin, so without this the
    // page cannot see the name the server chose for the file, nor whether the
    // figure was already made. Both are things it displays.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Render-Cache');
    res.setHeader(
      'Content-Disposition',
      `${ATTACHMENT.has(format) ? 'attachment' : 'inline'}; ` +
        `filename="${params.pathway || 'genome-wide'}.${format}"`
    );
    return res.end(bytes);
  } catch (error) {
    const status = statusOf(error);
    // A rejection is not a failure: it is the queue doing its job, and counting
    // it as a failure hides real ones in the noise of a busy period.
    if (status === 503) res.setHeader('Retry-After', '5');
    else stats.failed++;
    console.error(`failed ${name}.${format}: ${messageOf(error)}`);
    return res.status(status).json({ error: messageOf(error) });
  }
};

// Express 4 does not wait on a handler's promise; the handler answers every
// failure itself (its catch above), so the promise is left on purpose.
app.get('/render/:name.:ext', (req, res) => void renderRoute(req, res));

/**
 * Only listen when run as a program, so the handlers can be imported and
 * exercised by a test.
 *
 * They could not be, and it cost: `repeated` was used and never imported, and
 * every gate passed -- because nothing in the suite ever executed a request.
 * content-node has been guarded this way all along; this brings the render
 * service into line.
 */
/**
 * Whether /health's build fingerprint hashes a file: a module, `.mjs` or `.ts`
 * (spec 013: a module renamed would drop out of the hash unseen), not a spec.
 * A declaration, so it is there however early the fingerprint is taken.
 */
export function isModule(name) {
  // A declaration (`.d.ts`) describes types for the checker; nothing runs it.
  return /\.(mjs|ts)$/.test(name) && !/\.(spec\.(mjs|ts)|d\.ts)$/.test(name);
}

export { app, cacheKey };

/**
 * Whether Node was started with this file, whatever it is called: the test
 * was `endsWith('service.mjs')`, which a service renamed to `.ts` (spec 013)
 * fails, so it would load, never listen, and exit 0 -- a restart loop in its
 * container. Compared after symlinks are resolved, as Node resolves its own.
 * scripts/is-entry.mjs does the same for the scripts, but the service images
 * ship only this directory.
 */
function startedDirectly() {
  try {
    return (
      Boolean(process.argv[1]) &&
      realpathSync(process.argv[1] as string) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

const started = startedDirectly();
const server = started
  ? app.listen(PORT, HOST, () => {
      console.log(`render service on http://${HOST}:${PORT}`);
      console.log(`  rendering against ${BASE}`);
      console.log(`  cache ${CACHE} (key ${CACHE_KEY})`);
      console.log(`  ${CONCURRENCY} concurrent, ${MAX_QUEUE} queued before 503`);
      console.log(
        MAX_CACHE
          ? `  keeping up to ${(MAX_CACHE / 1024 ** 2).toFixed(0)} MB of figures`
          : `  cache size unbounded (RENDER_CACHE_MAX=0)`
      );
    })
  : null;

if (server) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => {
        void (browser ? browser.close() : Promise.resolve()).then(() => process.exit(0));
      });
    });
  }
}
