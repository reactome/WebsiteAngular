#!/usr/bin/env node
/**
 * The ratchets' totals may not rise (spec 014, research R5).
 *
 * The per-module baselines (tools/loose-baseline.json,
 * tools/implicit-any-baseline.json) are rewritten in any pull request that
 * moves code between modules: the module it leaves goes down, the one it
 * reaches goes up, and the per-module checks read the baseline in the tree.
 * So a move could carry a rise inside it unseen. This compares each
 * baseline's total with the base branch's: a move keeps the totals, typing
 * lowers them, nothing may raise them. lint-baseline.json's total and the
 * dead-code total are compared too.
 *
 *   node scripts/check-baseline-totals.mjs [base]    # base defaults to origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'origin/main';

/** The baselines, and how each one's total is read. */
const BASELINES = [
  ['loose', 'tools/loose-baseline.json', (json) => sum(Object.values(json))],
  ['implicit any', 'tools/implicit-any-baseline.json', (json) => sum(Object.values(json))],
  ['lint', 'lint-baseline.json', (json) => json.warnings],
  ['dead code', 'dead-code-baseline.json', (json) => json.total],
];

function sum(values) {
  return values.reduce((total, n) => total + n, 0);
}

function atBase(file) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }));
  } catch {
    // A baseline the base branch does not have yet is new: nothing to rise from.
    return undefined;
  }
}

const read = [];
const rose = [];
for (const [name, file, total] of BASELINES) {
  const now = total(JSON.parse(readFileSync(file, 'utf8')));
  const was = atBase(file);
  const before = was === undefined ? undefined : total(was);
  if (typeof now !== 'number' || (before !== undefined && typeof before !== 'number'))
    throw new Error(`${file}: no total to read`);
  read.push(`${name} ${now} (base ${before ?? 'none'})`);
  if (before !== undefined && now > before) rose.push(`${name} rose: ${now}, base ${before}`);
}

console.log(`  ${read.join(' · ')}`);
if (rose.length) {
  for (const line of rose) console.log(`  ${line} -- a move keeps totals; typing lowers them`);
  process.exit(1);
}
