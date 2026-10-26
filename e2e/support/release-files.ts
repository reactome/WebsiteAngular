/**
 * Release files -- what a page reads from download.reactome.org: diagram and
 * graph JSON, illustrated-pathway SVGs, icons, statistics -- served from saved
 * copies in e2e/release-files, the way the backend is served from recordings.
 *
 * They used to be fetched live (the host is in ALLOWED), which made the suite's
 * answer depend on the host as well as the code: one file that intermittently
 * failed to load in the browser failed four in-diagram search tests and held a
 * shard to its time limit, on pull requests that had not touched anything near
 * it.
 *
 * Only what a page *reads* is saved: requests made with fetch or XHR, which are
 * subject to CORS and carry the data. Images, video and links still go to the
 * host -- a missing image is shown as missing and the page carries on.
 *
 * A missing copy is not fetched: the request is aborted and the test fails,
 * naming the file. `E2E_SAVE_RELEASE_FILES=1` (and recording, `E2E_RECORD=1`)
 * fetches what is missing from the host and saves it instead.
 */
import type { BrowserContext, TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HOST = /^https:\/\/download\.reactome\.org\//;
const DIR = path.join(__dirname, '..', 'release-files');
const SAVE = process.env['E2E_SAVE_RELEASE_FILES'] === '1' || process.env['E2E_RECORD'] === '1';

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};

/** Where a request's copy lives: the host's path, under DIR. */
export function copyOf(url: string): string {
  // URL() has already resolved any `..`, so the path cannot leave DIR.
  return path.join(DIR, decodeURIComponent(new URL(url).pathname));
}

export async function serveReleaseFiles(context: BrowserContext) {
  const missing = new Set<string>();
  await context.route(HOST, async (route) => {
    const request = route.request();
    const type = request.resourceType();
    if ((type !== 'fetch' && type !== 'xhr') || request.method() !== 'GET') {
      return route.fallback();
    }
    const file = copyOf(request.url());
    if (existsSync(file)) {
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
          // The page is on another origin, as it is in front of the real host.
          'access-control-allow-origin': '*',
        },
        body: readFileSync(file),
      });
    }
    if (!SAVE) {
      missing.add(request.url());
      return route.abort();
    }
    const response = await route.fetch();
    // Only a file that exists is kept. Anything else is passed on as it came
    // and not saved, so a replay aborts it and the test says which file.
    if (response.status() === 200) {
      mkdirSync(path.dirname(file), { recursive: true });
      // Written beside it and renamed: another worker asking for the same file
      // must never be served half of it, nor an interrupted run leave half.
      const part = `${file}.part-${process.pid}`;
      writeFileSync(part, await response.body());
      renameSync(part, file);
    } else {
      console.warn(`[release files] ${response.status()} for ${request.url()}; not saved`);
    }
    return route.fulfill({ response });
  });
  return {
    check(testInfo: TestInfo) {
      // Reported even when the test failed: a missing file is usually why. Not
      // for a test that skipped itself, which has said what it could not do.
      if (!missing.size || testInfo.status === 'skipped') return;
      throw new Error(
        `${testInfo.title}: no saved copy of ${missing.size} release file${missing.size === 1 ? '' : 's'} (aborted):\n\n` +
          `${[...missing].map((url) => `  ${url}`).join('\n')}\n\n` +
          'Save them from the host, once, and commit e2e/release-files:\n\n' +
          `  E2E_SAVE_RELEASE_FILES=1 npm run e2e -- ${path.relative(process.cwd(), testInfo.file)}`
      );
    },
  };
}
