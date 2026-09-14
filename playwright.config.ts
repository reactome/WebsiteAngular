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
const baseURL = externalBaseURL || 'http://localhost:4200';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
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
    },
  ],
  // Only manage a server when we're the ones who started it.
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: 'npm run start:simple',
          url: baseURL,
          reuseExistingServer: !process.env['CI'],
          // A cold Angular build well exceeds playwright's 60s default.
          timeout: 180_000,
        },
      }),
});
