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
 * One recording per **test**, not per spec file. Playwright writes the HAR when a
 * browser context closes, and every test gets its own context -- so tests sharing
 * a file overwrite each other rather than merging, and the last one wins. A spec
 * whose final test skips would close having requested nothing and leave an empty
 * file: `custom-interactor-dialog` recorded 0 entries for 9 tests that way, and
 * `content-pages` 5 for 18. Every recording lives in one directory even so,
 * because Playwright names response bodies by their content hash -- identical
 * payloads across tests collapse to a single file only while they are siblings.
 */
import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RECORD = process.env['E2E_RECORD'] === '1';

/** Everything this site treats as "the backend". Anything else is untouched. */
const BACKEND = /\/(ContentService|AnalysisService|ExperimentDigester)\//;

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
      const entry = entries.get(key(route.request().method(), route.request().url()));
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
});

export { expect };
