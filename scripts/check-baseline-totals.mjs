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
 * lowers them, nothing may raise them. No module may rise either, so a rise
 * cannot hide behind a fall elsewhere -- one the base does not list counts
 * from 0, as the per-module checks hold it: --update drops a module at zero,
 * so every typed module is absent from the base's baseline. lint-baseline.json's
 * total and the dead-code total are compared too.
 *
 *   node scripts/check-baseline-totals.mjs [base]    # base defaults to origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'origin/main';

// A base that is not there is no comparison at all, and must not read as one
// with nothing to rise from.
try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { stdio: 'pipe' });
} catch {
  console.log(`  ${base} is not a commit here: fetch it, or name the base to compare with`);
  process.exit(1);
}

/** The baselines, and how each one's total is read. */
const BASELINES = [
  ['loose', 'tools/loose-baseline.json', (json) => sum(Object.values(json))],
  ['implicit any', 'tools/implicit-any-baseline.json', (json) => sum(Object.values(json))],
  // The per-rule counts are what check-lint.mjs holds the code to; `warnings`
  // is only written alongside them.
  ['lint', 'lint-baseline.json', (json) => sum(Object.values(json.rules))],
  ['dead code', 'dead-code-baseline.json', (json) => json.total],
];

function sum(values) {
  return values.reduce((total, n) => total + n, 0);
}

function atBase(file) {
  // A baseline the base branch does not have yet is new: nothing to rise from.
  // Any other failure to read it is a failure.
  const listed = execFileSync('git', ['ls-tree', '--name-only', base, '--', file], {
    encoding: 'utf8',
  });
  if (!listed.trim()) return undefined;
  return JSON.parse(execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }));
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

// No module may rise: one the base does not list is at 0 there (a module
// typed to zero leaves the baseline). Spec 014's split, whose modules received
// moved code and could rise while service.ts fell, is done; untyped code moved
// into a new module now has to be typed as it moves, as new code does --
// renaming or splitting a module that still has counts (pptx.ts, the specs
// still listed) is refused until they are typed away.
for (const [name, file] of BASELINES.slice(0, 2)) {
  const now = JSON.parse(readFileSync(file, 'utf8'));
  const was = atBase(file) ?? {};
  for (const [module, count] of Object.entries(now))
    if (count > (was[module] ?? 0))
      rose.push(`${name} in ${module} rose: ${count}, base ${was[module] ?? 0}`);
}

// Lint's counts are per rule and global, so no move changes them; a rise in
// one rule must not hide behind a fall in another (check-lint.mjs's own
// reason for counting per rule).
const lintNow = JSON.parse(readFileSync('lint-baseline.json', 'utf8')).rules;
const lintWas = atBase('lint-baseline.json')?.rules ?? {};
for (const [rule, count] of Object.entries(lintNow))
  if (count > (lintWas[rule] ?? 0))
    rose.push(`lint rule ${rule} rose: ${count}, base ${lintWas[rule] ?? 0}`);

console.log(`  ${read.join(' · ')}`);
if (rose.length) {
  for (const line of rose) console.log(`  ${line} -- a move keeps totals; typing lowers them`);
  process.exit(1);
}
