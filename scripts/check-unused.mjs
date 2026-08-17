#!/usr/bin/env node
/**
 * Fails when the amount of dead code goes up.
 *
 * This repo has no linter, so nothing caught unused code except review -- and
 * review missed it: an import added for one approach survived the approach being
 * replaced, and only turned up when someone went looking. There are 100-odd
 * pre-existing cases, so switching `noUnusedLocals` on in tsconfig would fail
 * every build until all of them were dealt with.
 *
 * A ratchet instead: the current count is recorded, new dead code fails, and
 * cleaning some up lowers the bar permanently. Nothing to remember, and no
 * flag-day cleanup needed first.
 *
 * Note that "unused" is not always wrong here -- reading a signal purely to
 * register a dependency inside an effect looks unused and is deliberate -- which
 * is another reason this reports rather than auto-fixes.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'unused-code-baseline.json');
// unused local / property / whole import declaration / declaration
const CODES = /error TS(6133|6138|6192|6196)/;

const run = () =>
  new Promise((resolve) => {
    execFile(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--noUnusedLocals',
        '--noUnusedParameters',
        // The app build graph, not tsconfig.json: that one pulls in spec files
        // without the test runner's globals and so never type-checked cleanly,
        // which would drown the signal this script is looking for.
        '-p',
        'tsconfig.app.json',
      ],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
      (_err, stdout, stderr) => resolve(`${stdout}${stderr}`)
    );
  });

const output = await run();
const findings = output
  .split('\n')
  .filter((line) => CODES.test(line))
  .map((line) => line.trim())
  .sort();

// Any real compile error means the count is meaningless -- report that instead
// of quietly comparing a number produced by a broken build.
const compileErrors = output
  .split('\n')
  .filter((line) => /error TS/.test(line) && !CODES.test(line));
if (compileErrors.length > 0) {
  console.error('Type errors unrelated to unused code; fix these first:\n');
  console.error(compileErrors.slice(0, 20).join('\n'));
  process.exit(1);
}

const updating = process.argv.includes('--update');
if (updating) {
  writeFileSync(BASELINE, `${JSON.stringify({ count: findings.length }, null, 2)}\n`);
  console.log(`Baseline set to ${findings.length}.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).count;
} catch {
  console.error(`No baseline at ${BASELINE}. Create it with: npm run check:unused -- --update`);
  process.exit(1);
}

if (findings.length > baseline) {
  console.error(`Dead code went up: ${findings.length} unused symbols, baseline is ${baseline}.\n`);
  console.error('All current findings (yours will be among them):\n');
  console.error(findings.join('\n'));
  console.error(
    '\nRemove the unused symbol. If it is a deliberate read -- calling a signal ' +
      'inside an effect only to register the dependency -- call it without ' +
      'assigning to a variable.'
  );
  process.exit(1);
}

if (findings.length < baseline) {
  console.log(
    `${findings.length} unused symbols, down from ${baseline}. ` +
      'Lock that in with: npm run check:unused -- --update'
  );
  process.exit(0);
}

console.log(`${findings.length} unused symbols, unchanged from the baseline.`);
