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

const project = 'tsconfig.app.json';
const result = spawnSync('npx', ['tsc', '--noEmit', '-p', project], { encoding: 'utf8' });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

if (result.status === 0) {
  console.log(`  ${project} ok`);
  process.exit(0);
}

console.log(`  ${project} FAILED (exit ${result.status})`);
for (const line of output.split('\n')) console.log(`    ${line}`);
console.log('\n  The build would fail on these.');
process.exit(1);
