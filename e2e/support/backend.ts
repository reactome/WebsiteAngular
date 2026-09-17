/**
 * Backend responses come from recordings, not from a live server.
 *
 * CI used to point `REACTOME_BACKEND` at https://reactome.org, so every push ran
 * the whole suite against the **public site** -- roughly 1,400 requests a run.
 * Besides the load, it made the suite fail whenever production had a bad minute:
 * a Cloudflare 521 arrived as
 *
 *     TimeoutError: page.waitForSelector: Timeout 90000ms exceeded.
 *       - waiting for locator('#cytoscape canvas') to be visible
 *
 * which says nothing about a backend and teaches you to press re-run (#217).
 *
 * Recording uses Playwright's own HAR writer. Replay does not use its reader:
 * `routeFromHAR` matches on the whole URL including the origin, so a recording
 * taken at `127.0.0.1:4253` misses every request at `localhost:4200` and the run
 * goes red for a reason that has nothing to do with the code. Measured, not
 * assumed -- recording and replaying on the same server through two spellings of
 * the same host was enough to fail it.
 *
 * So entries are matched on **method, path and query**, and the origin is
 * ignored. Record wherever it is convenient; replay wherever CI happens to serve.
 *
 * Two recordings per test. Playwright's HAR writer only sees **browser** traffic,
 * but several specs probe the backend through the `request` fixture -- an API
 * context the browser knows nothing about -- to decide whether to skip:
 *
 *     const up = await serves(request, '/ContentService/data/query/…');
 *     test.skip(!up, 'the content service is not reachable from here');
 *
 * Those calls are invisible to `routeFromHAR`, so under replay they reach the
 * closed port, fail, and the test **skips itself**. Fourteen of them did, and a
 * suite that quietly runs fourteen fewer tests while reporting green is worse
 * than one that fails. So they are recorded alongside, into `<name>.api.json`,
 * and replayed from there.
 *
 * One recording per **test**, not per spec file. Playwright writes the HAR when a
 * browser context closes, and every test gets its own context -- so tests sharing
 * a file overwrite each other rather than merging, and the last one wins. A spec
 * whose final test skips would close having requested nothing and leave an empty
 * file: `custom-interactor-dialog` recorded 0 entries for 9 tests that way, and
 * `content-pages` 5 for 18. Every recording lives in one directory even so,
 * because Playwright names response bodies by their content hash -- identical
 * payloads across tests collapse to a single file only while they are siblings.
 */
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RECORD = process.env['E2E_RECORD'] === '1';

/**
 * Everything this site treats as "the backend". Anything else is untouched.
 *
 * `idg.reactome.org` is in here because the browser calls it **directly** --
 * `IDG_SERVICE` is an absolute URL and it is not in `proxy.conf.js` -- so it is
 * not covered by pointing REACTOME_BACKEND anywhere. Without this line every run
 * of the suite, on every push, reached that server.
 */
const BACKEND = /\/(ContentService|AnalysisService|ExperimentDigester)\/|idg\.reactome\.org/;

/** Every request method that could reach the backend. */
const VERBS = ['get', 'post', 'head', 'put', 'patch', 'delete', 'fetch'] as const;
type Verb = (typeof VERBS)[number];

interface HarEntry {
  request: { method: string; url: string };
  response: {
    status: number;
    headers: { name: string; value: string }[];
    content: { text?: string; encoding?: string; mimeType?: string; _file?: string };
  };
}

/** `METHOD /path?query` -- deliberately without the origin. */
function key(method: string, url: string): string {
  const u = new URL(url);
  return `${method.toUpperCase()} ${u.pathname}${u.search}`;
}

/** Playwright writes large bodies beside the HAR and references them by name. */
function bodyOf(entry: HarEntry, harDir: string): Buffer {
  const c = entry.response.content;
  if (c._file) return readFileSync(path.join(harDir, c._file));
  if (c.text === undefined) return Buffer.alloc(0);
  return Buffer.from(c.text, c.encoding === 'base64' ? 'base64' : 'utf8');
}

function load(har: string): Map<string, HarEntry> {
  const log = JSON.parse(readFileSync(har, 'utf8')) as { log: { entries: HarEntry[] } };
  const index = new Map<string, HarEntry>();
  for (const entry of log.log.entries) {
    // A recorded status below 100 means the request never produced a response --
    // it was still in flight when the page navigated away, which is common for
    // the third-party PSICQUIC calls and for analysis polling. Leaving those out
    // means a request matching only such an entry is aborted, which is exactly
    // what happened to it when the recording was taken.
    if (entry.response.status < 100) continue;
    // First write wins. A spec that asks for the same thing twice recorded it
    // twice; the responses match, and the first is the one it saw first.
    const k = key(entry.request.method, entry.request.url);
    if (!index.has(k)) index.set(k, entry);
  }
  return index;
}

/**
 * `<spec>--<test title>`, readable so a diff says which test changed, and slugged
 * so it is a filename. The short digest keeps two tests whose titles slug to the
 * same thing from sharing a recording.
 */
function recordingName(testInfo: { file: string; titlePath: string[] }): string {
  const spec = path.basename(testInfo.file).replace(/\.spec\.ts$/, '');
  const title = testInfo.titlePath.slice(1).join(' ');
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const digest = createHash('sha1').update(title).digest('hex').slice(0, 6);
  return `${spec}--${slug}-${digest}`;
}

/** A probe's recorded answer, keyed like the HAR entries. */
interface ApiRecording {
  status: number;
  headers: Record<string, string>;
  body: string;
  encoding: 'utf8' | 'base64';
}

/** Enough of APIResponse for what the specs ask of it. */
function fakeResponse(rec: ApiRecording) {
  const buffer = Buffer.from(rec.body, rec.encoding);
  return {
    ok: () => rec.status >= 200 && rec.status < 300,
    status: () => rec.status,
    statusText: () => '',
    url: () => '',
    headers: () => rec.headers,
    body: async () => buffer,
    text: async () => buffer.toString('utf8'),
    json: async () => JSON.parse(buffer.toString('utf8')),
    dispose: async () => {},
  };
}

/**
 * Every recording, pooled, as a fallback for one test's own.
 *
 * A request still in flight when its test ends is written with status -1 -- no
 * response was ever received -- and is therefore unusable. That is common for
 * reference data a page fetches once and does not wait for: the DOI page asks for
 * `/data/species/main`, the recording caught it mid-flight, and on replay the
 * abort left the page unable to initialise at all.
 *
 * These responses are the same wherever they are asked for, so a usable copy from
 * another test is a correct answer rather than a guess. A test's own recording
 * always wins; this is only consulted on a miss.
 */
let pooled: Map<string, HarEntry> | null = null;

function pool(harDir: string): Map<string, HarEntry> {
  if (pooled) return pooled;
  pooled = new Map<string, HarEntry>();
  for (const name of readdirSync(harDir)) {
    if (!name.endsWith('.har')) continue;
    for (const [k, entry] of load(path.join(harDir, name))) {
      if (!pooled.has(k)) pooled.set(k, entry);
    }
  }
  return pooled;
}

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    const har = path.join(testInfo.project.testDir, 'har', `${recordingName(testInfo)}.har`);

    if (RECORD) {
      await context.routeFromHAR(har, { url: BACKEND, update: true, notFound: 'fallback' });
      await use(context);
      return;
    }

    const harDir = path.dirname(har);
    const entries = existsSync(har) ? load(har) : new Map<string, HarEntry>();

    await context.route(BACKEND, async (route) => {
      const method = route.request().method();
      const asked = key(method, route.request().url());
      // The pool is consulted for idempotent reads only. A POST's answer depends
      // on its body, which the key does not carry and the trimmed recordings do
      // not keep: eleven tests POST to
      // `/ContentService/interactors/static/molecules/details` with a different
      // list of accessions each, so borrowing another test's reply would hand one
      // pathway's interactors to another -- rendering plausible, wrong numbers.
      // A miss on a write is an abort, and an abort is visible.
      const shareable = method === 'GET' || method === 'HEAD';
      const entry = entries.get(asked) ?? (shareable ? pool(harDir).get(asked) : undefined);
      if (!entry) {
        // Aborted, never passed through. Falling back to the network would
        // quietly restore the thing this removes, and the first sign would be an
        // outage rather than a failing test.
        await route.abort();
        return;
      }
      const headers: Record<string, string> = {};
      for (const h of entry.response.headers) {
        // Recorded framing does not describe the body we are about to send.
        if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(h.name)) {
          headers[h.name] = h.value;
        }
      }
      await route.fulfill({
        status: entry.response.status,
        headers,
        body: bodyOf(entry, harDir),
      });
    });

    await use(context);
  },

  // The `request` fixture is a separate API context: `context.route()` above does
  // not touch it. Backend probes made through it are recorded beside the HAR and
  // replayed from there, so a fixtured backend reads as *present* rather than
  // absent. Anything that is not the backend -- Tina, the render service, EBI --
  // passes straight through, recording and replaying alike.
  request: async ({ request, baseURL }, use, testInfo) => {
    const sidecar = path.join(
      testInfo.project.testDir,
      'har',
      `${recordingName(testInfo)}.api.json`
    );
    const recorded: Record<string, ApiRecording> = RECORD
      ? {}
      : existsSync(sidecar)
        ? (JSON.parse(readFileSync(sidecar, 'utf8')) as Record<string, ApiRecording>)
        : {};

    const absolute = (url: string) => new URL(url, baseURL ?? 'http://localhost:4200').toString();

    // Every method that can reach the backend, not just the ones the specs happen
    // to use today. `fetch` was the gap: a spec calling request.fetch() would have
    // slipped past the recordings and out to whatever REACTOME_BACKEND names.
    type Options = Parameters<APIRequestContext['get']>[1];

    const wrap = (method: Verb) => async (url: string, options?: Options) => {
      const full = absolute(url);
      if (!BACKEND.test(full)) return request[method](url, options);

      const k = key(method, full);
      if (!RECORD) {
        const rec = recorded[k];
        // No recording means the probe never ran when this was taken. Report it
        // as unreachable rather than inventing a success -- but say so, because
        // silence here is what produced the fourteen skips.
        if (!rec) {
          console.warn(`[backend fixture] no recording for ${k}; reporting it unreachable`);
          return fakeResponse({ status: 0, headers: {}, body: '', encoding: 'utf8' });
        }
        return fakeResponse(rec);
      }

      const response = await request[method](url, options);
      const buffer = await response.body().catch(() => Buffer.alloc(0));
      const text = buffer.toString('utf8');
      const printable = Buffer.from(text, 'utf8').equals(buffer);
      recorded[k] = {
        status: response.status(),
        headers: response.headers(),
        body: printable ? text : buffer.toString('base64'),
        encoding: printable ? 'utf8' : 'base64',
      };
      return response;
    };

    const proxied = new Proxy(request, {
      get(target, prop, receiver) {
        if (VERBS.includes(prop as Verb)) return wrap(prop as Verb);
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    await use(proxied);

    if (RECORD && Object.keys(recorded).length) {
      writeFileSync(sidecar, JSON.stringify(recorded, null, 0));
    }
  },
});

export { expect };
