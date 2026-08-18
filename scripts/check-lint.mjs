#!/usr/bin/env node
/**
 * Lint gate for a codebase that had no linter until now.
 *
 * Two things are enforced:
 *
 *   errors    must stay at zero. eslint.config.js keeps a rule at "error" only
 *             when the codebase is already clean of it, so any error means a new
 *             violation of something previously spotless.
 *   warnings  must not increase. There are ~1600 pre-existing ones; requiring
 *             them all fixed before the linter could land would have meant the
 *             linter never landing. The count is recorded here and can only go
 *             down.
 *
 * Fixing the last violation of a warned rule is the cue to promote it to error
 * in eslint.config.js, which is how this converges rather than sitting at 1600
 * forever.
 *
 * Run with --update after reducing the count to lock in the improvement.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'lint-baseline.json');
const REPORT = join(tmpdir(), `eslint-report-${process.pid}.json`);

await new Promise((resolve) => {
  execFile(
    'npx',
    ['eslint', '.', '--format', 'json', '-o', REPORT],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
    () => resolve() // a non-zero exit just means findings; the report is what matters
  );
});

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (cause) {
  console.error('eslint produced no report; it probably failed to start.');
  console.error(cause.message);
  process.exit(1);
}
try {
  unlinkSync(REPORT);
} catch {
  // Leaving a temp file behind is not worth failing over.
}

const errors = report.flatMap((file) =>
  file.messages
    .filter((m) => m.severity === 2)
    .map(
      (m) =>
        `${relative(ROOT, file.filePath)}:${m.line}  ${m.ruleId ?? 'parse-error'}  ${m.message}`
    )
);
const warningCount = report.reduce((sum, file) => sum + file.warningCount, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ warnings: warningCount }, null, 2)}\n`);
  console.log(`Baseline set to ${warningCount} warnings.`);
  process.exit(errors.length > 0 ? 1 : 0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).warnings;
} catch {
  console.error(`No baseline at ${BASELINE}. Create it with: npm run check:lint -- --update`);
  process.exit(1);
}

if (errors.length > 0) {
  console.error(
    `${errors.length} lint error(s). These rules had no violations, so each of ` + 'these is new:\n'
  );
  console.error(errors.join('\n'));
  process.exit(1);
}

if (warningCount > baseline) {
  console.error(
    `Lint warnings went up: ${warningCount}, baseline is ${baseline}.\n` +
      'Run `npx eslint .` to see them, and fix the ones you introduced.'
  );
  process.exit(1);
}

if (warningCount < baseline) {
  console.log(
    `${warningCount} warnings, down from ${baseline}. ` +
      'Lock that in with: npm run check:lint -- --update'
  );
  process.exit(0);
}

console.log(`No errors; ${warningCount} warnings, unchanged from the baseline.`);
