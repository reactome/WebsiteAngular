/**
 * Make flaky e2e tests visible, and stop the number growing quietly.
 *
 * `playwright.config.ts` retries twice in CI. A test that fails and then passes
 * is reported as **flaky** and the build goes green — the fact is in the log and
 * nowhere else, so nobody is accountable for a number that can only rise.
 *
 * That matters more than it sounds. A flaky test is not occasionally wrong; it
 * is telling you something and being silenced. One of the three known ones
 * turned out to have a real race in the application: badges are added to the
 * graph and the handler that hides them runs afterwards, so reading once could
 * catch the moment in between. That was found only because someone looked at a
 * retry.
 *
 * This is deliberately **not** a proposal to remove retries. These suites reach
 * real services over a network and some non-determinism is honest. The problem
 * is invisibility, so:
 *
 *   * every flaky test is written to the job summary, where it is seen without
 *     reading a log
 *   * the count is ratcheted, like `check:lint` and `check:dead`, so it cannot
 *     grow without someone deciding that it should
 *
 * Usage:  node scripts/check-flaky.mjs <playwright-json-report> [...more]
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

/**
 * The most flaky tests **one shard** may report.
 *
 * Read that carefully, because it is not the number in #217. CI runs the suite
 * sharded four ways and this script runs per shard, so a baseline of N means a
 * ceiling of 4N across the suite. Setting it to the three known today would
 * have allowed twelve, which is a ratchet that does not ratchet.
 *
 * Two per shard, so the effective ceiling is eight rather than twelve. Still
 * looser than the three known, and the honest fix is to aggregate the four
 * shards' reports in a job that runs after them and cap the total once. That is
 * more CI machinery than this is worth today, and is left undone deliberately
 * rather than by oversight.
 *
 * The three known when this was written: `download-feedback` "says it is
 * working during the wait", `back-button` "leaves the pathway browser without
 * stepping through tabs first", `pathway-browser` "the Expression tab renders
 * the Expression Atlas heatmap". A fourth was fixed in #216 rather than
 * accepted, which is the direction this is meant to encourage.
 *
 * Lower it when one is fixed. Raising it should take an argument.
 */
const BASELINE = Number(process.env.FLAKY_BASELINE ?? 2);

/** Walks the report's nested suites and yields every test. */
function* tests(node) {
  for (const suite of node.suites ?? []) yield* tests(suite);
  for (const spec of node.specs ?? []) {
    for (const test of spec.tests ?? []) {
      yield { title: spec.title, file: spec.file ?? node.file, status: test.status };
    }
  }
}

const reports = process.argv.slice(2).filter((path) => existsSync(path));
if (reports.length === 0) {
  console.log('  no playwright report found; nothing to check');
  process.exit(0);
}

const flaky = [];
for (const path of reports) {
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    // A malformed report is not a pass. Say so rather than counting zero.
    console.error(`  could not read ${path}: ${error.message}`);
    process.exit(1);
  }
  for (const test of tests(report)) {
    if (test.status === 'flaky') flaky.push(`${test.file} › ${test.title}`);
  }
}

const lines = [
  flaky.length === 0
    ? '### No flaky tests'
    : `### ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'} in this shard (per-shard baseline ${BASELINE})`,
  '',
  ...flaky.map((name) => `- \`${name}\``),
  '',
  flaky.length === 0
    ? 'Every test passed first time.'
    : 'These passed only on retry. A retry is a fact about the application or the network, and worth reading rather than accepting.',
];

console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

if (flaky.length > BASELINE) {
  console.error(
    `\n  Flaky tests in this shard: ${flaky.length}, per-shard baseline is ${BASELINE}.` +
      `\n  Fix the new one, or raise FLAKY_BASELINE deliberately and say why.`
  );
  process.exit(1);
}
