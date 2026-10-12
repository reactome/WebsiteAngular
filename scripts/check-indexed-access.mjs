#!/usr/bin/env node
/**
 * Hold the `noUncheckedIndexedAccess` findings at today's count, file by file,
 * in the projects that do not have the flag yet (#345).
 *
 * The app and the embeddable diagram reached zero and have it in their own
 * tsconfig.app.json, so their builds enforce it. What is left is the workspace
 * libraries, listed in PROJECTS; when they reach zero too, the flag goes into
 * tsconfig.json for everything and this check goes.
 *
 * With the flag, `arr[i]` and `record[key]` are typed `T | undefined`, which is
 * the honest type: an index out of range or a missing key really is undefined,
 * and the code then dereferences it. It is a compiler flag, so it has no warning
 * level, and turning it on fails the build until every finding is handled. This
 * counts them instead, the way scripts/check-lint.mjs holds its warnings: per
 * file, because a total lets a new finding hide behind a fix elsewhere, and a
 * file the baseline does not list is held at zero.
 *
 * Moving or renaming a file with findings shows as an increase under its new
 * path. Check the total is unchanged, then run with --update.
 *
 * It runs each project's own build config with the flag added. A run that
 * fails without naming a single finding is a crash, not a clean result, and is
 * refused. (tsconfig.spec.json is left out: it cannot resolve vitest/globals,
 * as scripts/check-types.mjs says.)
 *
 *     node scripts/check-indexed-access.mjs           check against the baseline
 *     node scripts/check-indexed-access.mjs --update  record today's counts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare } from './check-lint.mjs';
import { isEntry } from './is-entry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'indexed-access-baseline.json');
const PROJECTS = [
  'projects/reactome-table/tsconfig.lib.json',
  'projects/reactome-gsa-form/tsconfig.lib.json',
];

/** `file(line,col): error TS…` lines, counted per file. */
export function countErrors(/** @type {string} */ output) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const line of output.split('\n')) {
    const match = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(line);
    if (match) counts[match[1]] = (counts[match[1]] ?? 0) + 1;
  }
  return counts;
}

/**
 * What a tsc run says: its findings, or that it could not be read as findings.
 * @param {number | null} status
 * @param {string} output
 */
export function outcome(status, output) {
  if (status === 0) return { ok: true, counts: {} };
  const counts = countErrors(output);
  // An error with no file -- a bad option, a missing tsconfig -- or a failure
  // with nothing counted means tsc did not get as far as the code.
  const global = output.split('\n').some((line) => /^error TS\d+:/.test(line));
  // A syntax error (TS1xxx) stops tsc before the type check, so the findings
  // it would have reported are missing, not fixed.
  const syntax = /\): error TS1\d{3}:/m.test(output);
  if (global || syntax || Object.keys(counts).length === 0) return { ok: false, counts };
  return { ok: true, counts };
}

/**
 * Several projects' counts as one: a file two projects compile is counted
 * once, at the larger of its counts.
 * @param {Record<string, number>[]} perProject
 */
export function mergeCounts(perProject) {
  /** @type {Record<string, number>} */
  const merged = {};
  for (const counts of perProject) {
    for (const [file, n] of Object.entries(counts)) merged[file] = Math.max(merged[file] ?? 0, n);
  }
  return merged;
}

const total = (/** @type {Record<string, number>} */ counts) =>
  Object.values(counts).reduce((a, b) => a + b, 0);

/** One project's findings per file, or exits when tsc did not get that far. */
function countProject(/** @type {string} */ project) {
  const result = spawnSync(
    'npx',
    ['tsc', '--noEmit', '--pretty', 'false', '-p', project, '--noUncheckedIndexedAccess'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const run = outcome(result.status, output);
  if (!run.ok) {
    console.error(
      `tsc did not get as far as the type check of ${project} (exit ${result.status}), so it has nothing to count:`
    );
    console.error(output.trim());
    process.exit(1);
  }
  return run.counts;
}

function main() {
  const merged = mergeCounts(PROJECTS.map(countProject));
  const counts = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  if (process.argv.includes('--update')) {
    writeFileSync(
      BASELINE,
      `${JSON.stringify({ total: total(counts), files: counts }, null, 2)}\n`
    );
    console.log(
      `Baseline set to ${total(counts)} findings in ${Object.keys(counts).length} files.`
    );
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error(`No baseline at ${BASELINE}: record one with --update.`);
    process.exit(1);
  }
  const baseline = /** @type {{ files: Record<string, number> }} */ (
    JSON.parse(readFileSync(BASELINE, 'utf8'))
  ).files;
  const { increased, decreased } = compare(counts, baseline);
  if (increased.length) {
    console.error('Unchecked indexed access went up (noUncheckedIndexedAccess, #345):\n');
    for (const { rule: file, was, now } of increased) console.error(`  ${file}: ${was} -> ${now}`);
    console.error(
      `\nGuard the new index reads in those files: an index out of range or a missing key is` +
        ` undefined. See them with:\n\n${PROJECTS.map((project) => `  npx tsc --noEmit -p ${project} --noUncheckedIndexedAccess`).join('\n')}\n\n` +
        `A file that was only moved or renamed shows here under its new path: if the total` +
        ` (${total(counts)} now, ${total(baseline)} before) has not gone up, run with --update.\n`
    );
    process.exit(1);
  }
  const was = total(baseline);
  const now = total(counts);
  if (decreased.length) {
    console.log(
      `Unchecked indexed access down from ${was} to ${now}: run with --update to lock it in.`
    );
  } else {
    console.log(`Unchecked indexed access: ${now}, unchanged from the baseline.`);
  }
  if (now === 0) {
    console.log('None left: add noUncheckedIndexedAccess to tsconfig.json, and remove this check.');
  }
}

if (isEntry(import.meta.url)) main();
