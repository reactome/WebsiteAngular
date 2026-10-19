#!/usr/bin/env node
/**
 * Lint gate for a codebase that had no linter until now.
 *
 * Two things are enforced:
 *
 *   errors    must stay at zero. eslint.config.js keeps a rule at "error" only
 *             when the codebase is already clean of it, so any error means a new
 *             violation of something previously spotless.
 *   warnings  must not increase, **rule by rule**. Each warned rule's count is
 *             recorded here and can only go down. It used to be one total, and
 *             a total lets a new violation of one rule hide behind a fix to
 *             another -- which, with several large rules on the ratchet at once,
 *             is the ordinary case rather than the unlucky one.
 *
 * Fixing the last violation of a warned rule is the cue to promote it to error
 * in eslint.config.js; the check says so when it happens.
 *
 * Run with --update after reducing a count to lock in the improvement.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntry } from './is-entry.mjs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'lint-baseline.json');
const LOOSE_BASELINE = join(ROOT, 'tools', 'loose-baseline.json');

/**
 * The services' loosely typed values (spec 013, research R5): `any` and what
 * it lets through, in tools/. Converting a service adds thousands at once, all
 * of them the work that spec does, so they are counted per module in
 * tools/loose-baseline.json, which may only go down, and kept out of the
 * per-rule counts here, which would otherwise have to rise.
 */
const LOOSE_RULE = /^@typescript-eslint\/(no-unsafe-[a-z-]+|no-explicit-any)$/;
export const isLoose = (path, rule) => path.startsWith('tools/') && LOOSE_RULE.test(rule ?? '');

const under = (file, root) => relative(root, file.filePath).split('\\').join('/');

/** Warnings per rule in an ESLint JSON report, the services' loose values apart. */
export function countWarnings(report, root = ROOT) {
  const rules = {};
  for (const file of report) {
    const path = under(file, root);
    for (const m of file.messages) {
      if (m.severity !== 1 || isLoose(path, m.ruleId)) continue;
      const rule = m.ruleId ?? '(no rule)';
      rules[rule] = (rules[rule] ?? 0) + 1;
    }
  }
  return rules;
}

/**
 * Compare per-rule warning counts with the baseline's.
 * A rule the baseline does not list is held at zero: a newly warned rule has
 * to be recorded with --update, deliberately, before it may have any.
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} baseline
 */
export function compare(counts, baseline) {
  const rules = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])].sort();
  const increased = [];
  const decreased = [];
  const cleared = [];
  for (const rule of rules) {
    const now = counts[rule] ?? 0;
    const was = baseline[rule] ?? 0;
    if (now > was) increased.push({ rule, was, now });
    else if (now < was) {
      decreased.push({ rule, was, now });
      if (now === 0) cleared.push(rule);
    }
  }
  return { increased, decreased, cleared };
}

/** The services' loose values per module. */
export function countLoose(report, root = ROOT) {
  const modules = {};
  for (const file of report) {
    const path = under(file, root);
    const n = file.messages.filter((m) => m.severity === 1 && isLoose(path, m.ruleId)).length;
    if (n > 0) modules[path] = n;
  }
  return modules;
}

/** Modules whose loose count went up; one the baseline does not list is held to none. */
export const looseIncreases = (counts, baseline) =>
  Object.entries(counts)
    .filter(([module, n]) => n > (baseline[module] ?? 0))
    .map(([module, n]) => `${module}: ${baseline[module] ?? 0} -> ${n}`)
    .sort();

const total = (rules) => Object.values(rules).reduce((a, b) => a + b, 0);

function sorted(rules) {
  return Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const reportFile = join(tmpdir(), `eslint-report-${process.pid}.json`);
  await new Promise((resolve) => {
    execFile(
      'npx',
      ['eslint', '.', '--format', 'json', '-o', reportFile],
      { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
      () => resolve() // a non-zero exit just means findings; the report is what matters
    );
  });

  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch (cause) {
    console.error('eslint produced no report; it probably failed to start.');
    console.error(cause.message);
    process.exit(1);
  }
  try {
    unlinkSync(reportFile);
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
  const counts = countWarnings(report);
  const loose = countLoose(report);

  if (process.argv.includes('--update')) {
    writeFileSync(
      BASELINE,
      `${JSON.stringify({ warnings: total(counts), rules: sorted(counts) }, null, 2)}\n`
    );
    writeFileSync(LOOSE_BASELINE, `${JSON.stringify(sorted(loose), null, 2)}\n`);
    console.log(
      `Baseline set to ${total(counts)} warnings across ${Object.keys(counts).length} rules.`
    );
    process.exit(errors.length > 0 ? 1 : 0);
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).rules;
  } catch {
    baseline = undefined;
  }
  if (!baseline) {
    console.error(
      `No per-rule baseline at ${BASELINE}. Create it with: npm run check:lint -- --update`
    );
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(
      `${errors.length} lint error(s). These rules had no violations, so each of ` +
        'these is new:\n'
    );
    console.error(errors.join('\n'));
    process.exit(1);
  }

  let looseBaseline = {};
  try {
    looseBaseline = JSON.parse(readFileSync(LOOSE_BASELINE, 'utf8'));
  } catch {
    // None yet: every module is held to none.
  }
  const looser = looseIncreases(loose, looseBaseline);
  if (looser.length > 0) {
    console.error('Loosely typed values in the services went up (tools/loose-baseline.json):\n');
    for (const line of looser) console.error(`  ${line}`);
    console.error('\nType them: `npx eslint <module>` lists them (spec 013).');
    process.exit(1);
  }

  const { increased, decreased, cleared } = compare(counts, baseline);
  if (increased.length > 0) {
    console.error('Lint warnings went up:\n');
    for (const { rule, was, now } of increased) console.error(`  ${rule}: ${was} -> ${now}`);
    console.error(
      '\nRun `npx eslint .` to see them, and fix the ones you introduced. A rule' +
        ' the baseline does not list is held at zero.'
    );
    process.exit(1);
  }

  if (decreased.length > 0) {
    console.log(
      `${total(counts)} warnings, down from ${total(baseline)}. ` +
        'Lock that in with: npm run check:lint -- --update'
    );
    for (const rule of cleared) {
      console.log(`  ${rule} has none left: promote it to "error" in eslint.config.js.`);
    }
    process.exit(0);
  }

  console.log(`No errors; ${total(counts)} warnings, unchanged from the baseline.`);
}

if (isEntry(import.meta.url)) await main();
