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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
