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
 *   node tools/render/service.mjs
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
 */
import express from 'express';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { FORMATS, render } from './render-core.mjs';

const PORT = Number(process.env.RENDER_PORT || 4310);
const HOST = process.env.RENDER_HOST || '127.0.0.1';
const BASE = process.env.RENDER_BASE || 'http://localhost:4200';
const CACHE = process.env.RENDER_CACHE || path.resolve('.render-cache');
const CACHE_KEY = process.env.RENDER_CACHE_KEY || 'v1';
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY || 2);
// Generous next to a real render, which is 3-8s, but far short of the two
// minutes a page that never becomes ready would otherwise hold a browser for.
const RENDER_TIMEOUT = Number(process.env.RENDER_TIMEOUT || 45_000);
const MAX_QUEUE = Number(process.env.RENDER_QUEUE || 8);

const CONTENT_TYPE = {
  svg: 'image/svg+xml; charset=utf-8',
  png: 'image/png',
  pdf: 'application/pdf',
};

const stats = { served: 0, hits: 0, rendered: 0, failed: 0, rejected: 0 };

// ---- browser -------------------------------------------------------------
// One browser for the process, a fresh page per render. Reusing a page leaks
// state between renders -- a stale analysis token being the obvious one -- and a
// page is cheap next to a browser.
let browser;
async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch();
  return browser;
}

// ---- queue ---------------------------------------------------------------
let active = 0;
const waiting = [];

function schedule(job) {
  if (active >= CONCURRENCY && waiting.length >= MAX_QUEUE) {
    stats.rejected++;
    const error = new Error('renderer saturated');
    error.status = 503;
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    waiting.push({ job, resolve, reject });
    pump();
  });
}

function pump() {
  while (active < CONCURRENCY && waiting.length) {
    const { job, resolve, reject } = waiting.shift();
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
function cacheKey({ pathway, format, token, scale, subpathways }) {
  // The token is part of the key rather than a reason not to cache: repeat
  // requests for the same analysis are exactly what a report generator makes.
  return createHash('sha256')
    .update([CACHE_KEY, pathway, format, token, scale, subpathways].join(' '))
    .digest('hex');
}

async function fromCache(key, format) {
  const file = path.join(CACHE, `${key}.${format}`);
  try {
    await stat(file);
    return await readFile(file);
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
async function exists(pathway) {
  if (!pathway) return true; // the genome-wide view takes no id
  try {
    const response = await fetch(`${BASE}/ContentService/data/query/${pathway}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    // If the check itself cannot run, let the render decide rather than
    // refusing work over a transient failure of something incidental.
    return true;
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

  if (!(await exists(params.pathway))) {
    const error = new Error(`no such pathway: ${params.pathway}`);
    error.status = 404;
    throw error;
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

// ---- http ----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    base: BASE,
    cache: CACHE,
    cacheKey: CACHE_KEY,
    active,
    waiting: waiting.length,
    ...stats,
  });
});

// "genome-wide" rather than an empty path segment, so the URL says what it is.
app.get('/render/:name.:ext', async (req, res) => {
  const { name, ext } = req.params;
  const format = ext.toLowerCase();
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: `unknown format "${format}"`, formats: FORMATS });
  }

  const params = {
    pathway: name === 'genome-wide' ? '' : name,
    format,
    token: typeof req.query.token === 'string' ? req.query.token : '',
    scale: Number(req.query.scale || 2),
    subpathways: req.query.subpathways !== 'false',
  };

  try {
    const { bytes, cached } = await renderCached(params);
    stats.served++;
    res.setHeader('Content-Type', CONTENT_TYPE[format]);
    res.setHeader('X-Render-Cache', cached ? 'hit' : 'miss');
    // Without a token a render is stable for a release; with one it lives about
    // as long as the analysis does.
    res.setHeader(
      'Cache-Control',
      params.token ? 'private, max-age=3600' : 'public, max-age=86400'
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${params.pathway || 'genome-wide'}.${format}"`
    );
    return res.end(bytes);
  } catch (error) {
    const status = error.status || 500;
    // A rejection is not a failure: it is the queue doing its job, and counting
    // it as a failure hides real ones in the noise of a busy period.
    if (status === 503) res.setHeader('Retry-After', '5');
    else stats.failed++;
    console.error(`failed ${name}.${format}: ${error.message}`);
    return res.status(status).json({ error: error.message });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`render service on http://${HOST}:${PORT}`);
  console.log(`  rendering against ${BASE}`);
  console.log(`  cache ${CACHE} (key ${CACHE_KEY})`);
  console.log(`  ${CONCURRENCY} concurrent, ${MAX_QUEUE} queued before 503`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      void (browser ? browser.close() : Promise.resolve()).then(() => process.exit(0));
    });
  });
}
