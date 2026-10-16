// @vitest-environment node
//
// The CI workflows' two safety rules, checked on every one of them.
//
// 1. No `${{ }}` expression a pull request controls inside a `run:` script.
//    The expression is pasted into the script before the shell sees it, so a
//    branch named `x$(curl …|sh)` ran in guardrail.yml (review, 16 Oct 2026).
//    Such values go through `env:` and are read as "$VARIABLE".
// 2. A `permissions:` block, so no job runs with the default token's scope.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('.github/workflows');
const workflows = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name));
const UNTRUSTED = /\$\{\{[^}]*github\.(head_ref|ref_name|base_ref|event\.)/;

/** The lines of every `run:` script, with their line numbers. */
function scriptLines(text) {
  const lines = text.split('\n');
  const found = [];
  for (let at = 0; at < lines.length; at += 1) {
    const run = /^(\s*)(- )?run:\s*(.*)$/.exec(lines[at]);
    if (!run) continue;
    const indent = run[1].length + (run[2] ? 2 : 0);
    if (run[3] && !/^[|>]/.test(run[3])) found.push([at + 1, run[3]]);
    for (let next = at + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() && line.search(/\S/) <= indent) break;
      found.push([next + 1, line]);
    }
  }
  return found;
}

describe.each(workflows)('%s', (name) => {
  const text = readFileSync(path.join(DIR, name), 'utf8');

  it('pastes nothing a pull request controls into a script', () => {
    const pasted = scriptLines(text).filter(([, line]) => UNTRUSTED.test(line));
    expect(pasted.map(([at, line]) => `${at}: ${line.trim()}`)).toEqual([]);
  });

  it('declares its token permissions', () => {
    expect(text).toMatch(/^permissions:/m);
  });
});
