#!/usr/bin/env node
/**
 * Holds the amount of unreachable code to a baseline.
 *
 * eslint catches an unused symbol inside a file. It cannot see a whole file that
 * nothing imports, or an export nobody consumes -- and that turned out to be the
 * larger pile: 48 files and ~100 exports and types with no reachable reference.
 *
 * This deliberately reports rather than deletes. Some findings are genuinely
 * dead (a util nothing imports), but others are not safe to remove on a count
 * alone -- the graph model classes, for instance, are referred to by schemaClass
 * name strings rather than by import, so "not imported" does not settle whether
 * the file matters. Deleting those needs someone who knows the data model.
 *
 * Run with --update after removing some, to lock in the improvement.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'dead-code-baseline.json');
const COUNTED = [
  'files',
  'exports',
  'types',
  'dependencies',
  'devDependencies',
  'enumMembers',
  'namespaceMembers',
];

const raw = await new Promise((resolve) => {
  execFile(
    'npx',
    ['knip', '--reporter', 'json'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
    (_err, stdout) => resolve(stdout) // non-zero exit just means findings
  );
});

let report;
try {
  report = JSON.parse(raw);
} catch (cause) {
  console.error('knip produced no parseable report:');
  console.error(cause.message);
  process.exit(1);
}

const issues = report.issues ?? [];
const counts = Object.fromEntries(
  COUNTED.map((kind) => [kind, issues.reduce((sum, i) => sum + (i[kind]?.length ?? 0), 0)])
);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const summary = Object.entries(counts)
  .filter(([, n]) => n > 0)
  .map(([kind, n]) => `${kind}: ${n}`)
  .join(', ');

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ total }, null, 2)}\n`);
  console.log(`Baseline set to ${total} (${summary}).`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).total;
} catch {
  console.error(`No baseline at ${BASELINE}. Create it with: npm run check:dead -- --update`);
  process.exit(1);
}

if (total > baseline) {
  console.error(`Unreachable code went up: ${total}, baseline is ${baseline}.\n${summary}\n`);
  console.error('Run `npx knip` for the list. Most likely you added a file or export nothing uses.');
  process.exit(1);
}

if (total < baseline) {
  console.log(
    `${total} unreachable items, down from ${baseline} (${summary}). ` +
      'Lock that in with: npm run check:dead -- --update'
  );
  process.exit(0);
}

console.log(`${total} unreachable items, unchanged from the baseline (${summary}).`);
