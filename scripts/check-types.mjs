/**
 * Typecheck what the build typechecks, unfiltered.
 *
 * A build-breaking type error cost most of an afternoon because the check I was
 * using was `tsc --noEmit -p tsconfig.json` piped through grep. Three things
 * were wrong with that, and the third is the one that matters:
 *
 *   1. tsconfig.json does not cover the application -- the build uses
 *      tsconfig.app.json.
 *   2. the grep pattern did not match the error anyway.
 *   3. that command does not merely fail, it *crashes*: tsconfig.json pulls in
 *      TypeScript sources from node_modules, and tsc dies with a heap overflow
 *      (exit 134) before reporting anything. A crash produces no matching lines
 *      and so reads exactly like a clean run.
 *
 * So: the project the build uses, every line of output, and the exit code
 * respected. Seconds rather than a full build, and it cannot report success by
 * accident.
 *
 * Not covered here, deliberately rather than by oversight:
 *   * e2e/ -- no tsconfig includes it; Playwright compiles specs as it runs, so
 *     a type error there surfaces when the suite does.
 *   * tsconfig.spec.json -- cannot resolve 'vitest/globals' from the root, so it
 *     fails for reasons that have nothing to do with the code under test. Worth
 *     fixing separately; claiming to check it while it errors would be worse
 *     than saying it is not checked.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// The site, and the server-side services (spec 013).
const projects = ['tsconfig.app.json', 'tools/tsconfig.json'];
let failed = false;
for (const project of projects) {
  const result = spawnSync('npx', ['tsc', '--noEmit', '-p', project], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) {
    console.log(`  ${project} ok`);
    continue;
  }
  failed = true;
  console.log(`  ${project} FAILED (exit ${result.status})`);
  for (const line of output.split('\n')) console.log(`    ${line}`);
}
if (failed) {
  console.log('\n  The build, or the services, would fail on these.');
  process.exit(1);
}

// The services with noImplicitAny on (spec 013, T021): a compiler option
// cannot be set per file, so the whole of tools/ is compiled with it and the
// errors -- every one of them the option's, the plain compile being clean --
// counted per module. A count may only go down; a module at none stays so.
// `--update` writes the counts as they are, to lock in a module typed.
const BASELINE = 'tools/implicit-any-baseline.json';
const strict = spawnSync(
  'npx',
  ['tsc', '--noEmit', '--noImplicitAny', '-p', 'tools/tsconfig.json'],
  {
    encoding: 'utf8',
  }
);
// tsc exits 2 when it found errors and 0 when it found none; anything else
// -- a crash, a signal, npx failing -- is no reading at all, and nor is an
// exit 2 with no error lines to count. Either would read as "none left" and
// invite --update to write an empty baseline, so it fails here instead.
const strictOutput = `${strict.stdout ?? ''}`;
const errorLines = strictOutput
  .split('\n')
  .filter((line) => /^\S.*\(\d+,\d+\): error TS\d+/.test(line));
if (
  strict.error ||
  ![0, 2].includes(strict.status) ||
  (strict.status === 2) !== errorLines.length > 0
) {
  console.log(`  tools/ with noImplicitAny: no reading (exit ${strict.status ?? strict.error})`);
  for (const line of `${strictOutput}${strict.stderr ?? ''}`.trim().split('\n'))
    console.log(`    ${line}`);
  process.exit(1);
}
// An error outside tools/ (a site model the services import) is the site's
// compile's to catch; one here means that did not, so say so.
const elsewhere = errorLines.filter((line) => !line.startsWith('tools/'));
if (elsewhere.length) {
  console.log('  noImplicitAny errors outside tools/, which nothing counts:\n');
  for (const line of elsewhere) console.log(`    ${line}`);
  process.exit(1);
}
const counts = {};
for (const line of errorLines) {
  const file = line.slice(0, line.indexOf('('));
  counts[file] = (counts[file] ?? 0) + 1;
}
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = Object.values(sorted).reduce((sum, n) => sum + n, 0);
  console.log(`  ${BASELINE}: ${total} in ${Object.keys(sorted).length} modules`);
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const up = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
const down = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n);
if (up.length) {
  console.log('  Implicit any in the services went up (noImplicitAny, ' + BASELINE + '):\n');
  for (const [file, n] of up) console.log(`    ${file}: ${baseline[file] ?? 0} -> ${n}`);
  console.log(
    '\n  Type them: `npx tsc --noEmit --noImplicitAny -p tools/tsconfig.json` lists them.'
  );
  process.exit(1);
}
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
console.log(`  tools/ with noImplicitAny: ${total} left, none new`);
// A fall not locked in is room a later change could fill unseen: the
// baseline would not move, and nothing would say the count rose again.
if (down.length) {
  console.log(`  ${down.length} module(s) went down; lock it in: npm run check:types -- --update`);
  for (const [file, n] of down) console.log(`    ${file}: ${n} -> ${counts[file] ?? 0}`);
  process.exit(1);
}
process.exit(0);
