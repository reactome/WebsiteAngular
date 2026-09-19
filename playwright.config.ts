import { defineConfig, devices } from '@playwright/test';

// By default the suite spins up its own `ng serve` on :4200. Set E2E_BASE_URL to
// run against something already running instead -- another local port, or a
// deployed environment:
//
//   E2E_BASE_URL=http://localhost:4310 npm run e2e
//   E2E_BASE_URL=https://beta.reactome.org npm run e2e
//
// Backend calls are host-relative (environment.ts derives them from
// window.location.origin), so a local server needs the /ContentService,
// /AnalysisService and /GSAServer entries in proxy.conf.json to reach a real
// backend. A deployed environment already routes those itself.
const externalBaseURL = process.env['E2E_BASE_URL'];

// E2E_PORT asks for a server of our own on a port nothing else is using, and is
// what the pre-push gate sets.
//
// The default of 4200 reuses whatever is already serving there, which is what
// you want while developing -- one `ng serve` with hot reload, many test runs.
// It is emphatically not what a gate wants. On a host that keeps a deployed
// build on 4200, reuse means the suite tests that build and not the working
// tree: `diagram-behaviour.spec.ts` failed for eight hours against a `dist/`
// that predated the fix it asserts, while CI was green (#243). The dangerous
// direction is the other one -- passing on a tree that is broken.
//
// A distinct port rather than `reuseExistingServer: false` on 4200, because the
// latter makes playwright abort on "port already in use", which on this host
// would mean stopping beta before every push.
const ownPort = process.env['E2E_PORT'];
const baseURL = externalBaseURL || `http://localhost:${ownPort || '4200'}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  // html for a person, json for `scripts/check-flaky.mjs`. Flakiness is
  // otherwise only in the log, where nobody reads it -- see #217.
  reporter: [
    ['html'],
    [
      'json',
      { outputFile: process.env['PLAYWRIGHT_JSON_REPORT'] || 'playwright-report/report.json' },
    ],
  ],
  /**
   * Longer than playwright's 30s default, because two specs wait up to 45s for
   * a page and could never reach it.
   *
   * `content-pages.spec.ts` and `interactive-state.spec.ts` both define
   * `LOAD = 45_000` and pass it to assertions. Under a 30s per-test ceiling
   * that budget was unreachable: the test was killed first, and what the report
   * said was `TIMEDOUT` rather than which assertion failed and what it saw. A
   * stated timeout that cannot be used is worse than a short one, because it
   * reads as deliberate.
   *
   * 60s leaves room for the slowest of those plus the page load they share it
   * with. The cost is that a genuinely hung test takes a minute rather than
   * thirty seconds to say so, which is paid only by runs that were going to be
   * red anyway.
   */
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // Two suites, because they answer different questions.
  //
  //   code     is the code right? Runs on every push and while developing. It
  //            must not depend on freshly generated release data, and anything
  //            that needs a backend feature the target may not have asks first
  //            and skips with a reason.
  //
  //   release  is the release right? Run after the release process has generated
  //            the database and published the files: every top-level pathway
  //            draws, every download link resolves, the version and the news and
  //            the statistics all say the release we are actually serving.
  //
  // The split is the directory: e2e/release/** is the second suite. It exists
  // because the whole of one day's CI trouble was release checks failing in a
  // code-verification context -- endpoints the target lacked, data it did not
  // have, and 29 diagram loads on a two-core runner.
  projects: [
    {
      name: 'code',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/release/**',
    },
    {
      name: 'release',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/release/**',
      // One retry, not the suite's two. These are sweeps against a published
      // site -- twenty-one diagram loads in one case -- so a second attempt is
      // worth having for a dropped connection, and a third only costs another
      // twelve minutes to reach the same answer. Retrying was a large part of
      // why the release job never finished inside its budget.
      retries: process.env['CI'] ? 1 : 0,
    },
  ],
  // Only manage a server when we're the ones who started it.
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          // npm appends extra args to the end of the script string, so this
          // becomes `... && ng serve --port <n>` and still runs the content
          // staging that the search specs need.
          command: ownPort ? `npm run start:simple -- --port ${ownPort}` : 'npm run start:simple',
          url: baseURL,
          // Never reuse when we asked for our own port: the point is to serve
          // the tree under test.
          reuseExistingServer: !process.env['CI'] && !ownPort,
          // A cold Angular build well exceeds playwright's 60s default, and the
          // gate always pays for one because it never reuses.
          timeout: ownPort ? 300_000 : 180_000,
        },
      }),
});
