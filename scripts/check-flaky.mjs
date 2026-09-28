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
 * It also reports every **skipped** test with its reason, and fails a shard on
 * a skip not listed in e2e/expected-skips.json. A test that skips itself when
 * the thing it checks is missing reports green while checking nothing -- the
 * audit in #321 found tests whose skip depended on test order, and others that
 * skipped in exactly the case they exist to catch. Listing the expected ones,
 * each with why, makes a new skip a decision rather than a quiet default.
 *
 * Usage:  node scripts/check-flaky.mjs <playwright-json-report> [...more]
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isEntry } from './is-entry.mjs';

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
      yield {
        title: spec.title,
        file: spec.file ?? node.file,
        status: test.status,
        // `fixme` is a skip too, with its own annotation.
        reason:
          (test.annotations ?? []).find((a) => a.type === 'skip' || a.type === 'fixme')
            ?.description ?? '',
      };
    }
  }
}

/** `file › title`, the key e2e/expected-skips.json uses. */
const name = (test) => `${path.basename(test.file ?? '')} › ${test.title}`;

/**
 * What one report says: flaky tests, and skips split into expected and not.
 * @param {unknown} report Playwright's JSON report
 * @param {Record<string, string>} expected skip name -> why
 */
export function summarise(report, expected) {
  const flaky = [];
  const skipped = [];
  const unexpected = [];
  const all = [...tests(report)];
  // A serial group stops at its first failure, and Playwright reports the rest
  // as skipped with no reason. On a run that is already red, those are not
  // skips anyone chose -- so they are said to be what they are, not refused.
  const failedFiles = new Set(all.filter((t) => t.status === 'unexpected').map((t) => t.file));
  for (const test of all) {
    if (test.status === 'flaky') flaky.push(name(test));
    if (test.status === 'skipped') {
      if (!test.reason && failedFiles.has(test.file)) {
        skipped.push({ name: name(test), reason: 'not run: an earlier test in its file failed' });
        continue;
      }
      const entry = { name: name(test), reason: test.reason || '(no reason given)' };
      skipped.push(entry);
      if (!(entry.name in expected)) unexpected.push(entry);
    }
  }
  return { flaky, skipped, unexpected };
}

function main() {
  // A report that is not there is a broken check, not a clean one: it used to
  // print "nothing to check" and pass, so a renamed report file would have
  // switched the flaky and skip checks off for good without anyone noticing.
  const named = process.argv.slice(2);
  const missing = named.filter((file) => !existsSync(file));
  if (named.length === 0 || missing.length > 0) {
    console.error(
      named.length === 0
        ? '  no Playwright report named; usage: check-flaky.mjs <report.json>'
        : `  no Playwright report at ${missing.join(', ')}; the e2e run did not write one`
    );
    process.exit(1);
  }
  const reports = named;
  const expected = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'e2e', 'expected-skips.json'), 'utf8')
  ).skips;

  const flaky = [];
  const skipped = [];
  const unexpected = [];
  for (const file of reports) {
    let report;
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      // A malformed report is not a pass. Say so rather than counting zero.
      console.error(`  could not read ${file}: ${error.message}`);
      process.exit(1);
    }
    const found = summarise(report, expected);
    flaky.push(...found.flaky);
    skipped.push(...found.skipped);
    unexpected.push(...found.unexpected);
  }

  const lines = [
    flaky.length === 0
      ? '### No flaky tests'
      : `### ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'} in this shard (per-shard baseline ${BASELINE})`,
    '',
    ...flaky.map((test) => `- \`${test}\``),
    '',
    flaky.length === 0
      ? 'Every test passed first time.'
      : 'These passed only on retry. A retry is a fact about the application or the network, and worth reading rather than accepting.',
    '',
    `### ${skipped.length} skipped in this shard${unexpected.length ? `, ${unexpected.length} not expected` : ''}`,
    '',
    ...skipped.map(
      (test) =>
        `- ${test.name in expected ? '' : '**not expected** — '}\`${test.name}\`: ${test.reason}`
    ),
  ];

  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }

  let failed = false;
  if (flaky.length > BASELINE) {
    console.error(
      `\n  Flaky tests in this shard: ${flaky.length}, per-shard baseline is ${BASELINE}.` +
        `\n  Fix the new one, or raise FLAKY_BASELINE deliberately and say why.`
    );
    failed = true;
  }
  if (unexpected.length) {
    console.error(
      `\n  ${unexpected.length} test${unexpected.length === 1 ? '' : 's'} skipped that e2e/expected-skips.json does not list.` +
        '\n  A skip reports green while checking nothing: find why it skipped, or list it with the reason it cannot run here.'
    );
    failed = true;
  }
  if (failed) process.exit(1);
}

if (isEntry(import.meta.url)) main();
