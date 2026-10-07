/**
 * Record the e2e backend fixtures, then drop what nothing references.
 *
 * Playwright writes each response body beside the HAR as a content-addressed
 * file, and writes the HAR index when the browser context closes. A test that
 * fails partway leaves its bodies on disk with no index entry pointing at them --
 * 78 files and 6.2 MB of them after one full run, roughly half the total, all of
 * it destined for a public repository for no reason.
 *
 * Exits with the *recording's* status, not the prune's. Chaining these with `;`
 * in an npm script would report success whenever the prune succeeded, which is
 * the silent-failure shape this repository keeps being bitten by.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const run = spawnSync('npx', ['playwright', 'test', '--project=code', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_RECORD: '1' },
});

spawnSync('node', [path.join(import.meta.dirname, 'trim-har.mjs')], { stdio: 'inherit' });
// Says at once if this recording caught an answer cut off mid-response, rather
// than leaving it for CI.
const check = spawnSync('node', [path.join(import.meta.dirname, 'check-har.mjs')], {
  stdio: 'inherit',
});

// The recording's failure first; a killed recording (no status) is a failure too.
const recorded = run.status ?? 1;
process.exit(recorded || (check.status ?? 1));
