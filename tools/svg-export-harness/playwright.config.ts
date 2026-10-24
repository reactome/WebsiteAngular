// The harness's own config: it is not part of `npm run e2e` (see README.md).
// Playwright collects only files named *.spec or *.test unless told otherwise,
// so the README's earlier `--config= harness.check.mjs` found no tests at all.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'harness.check.ts',
  // With the root config's results, which are ignored, rather than in tools/.
  outputDir: '../../test-results/svg-export-harness',
  // Builds the bundle the page loads, then serves this directory.
  webServer: {
    command:
      'npx esbuild tools/svg-export-harness/harness.ts --bundle --format=esm ' +
      '--outfile=tools/svg-export-harness/harness.bundle.js && ' +
      'npx --yes http-server@14.1.1 tools/svg-export-harness -a 127.0.0.1 -p 3334 -s -c -1',
    cwd: '../..',
    url: 'http://127.0.0.1:3334/index.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
