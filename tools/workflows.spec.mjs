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
// Whatever a pull request, a dispatcher or an event names: branch and ref
// names, event payloads, dispatch inputs. Matched inside each `${{ … }}`
// whole -- an expression may contain braces itself, format('{0}', …).
const UNTRUSTED = /github\.(head_ref|ref_name|base_ref|event\.)|\binputs\./;
const pastes = (line) =>
  [...line.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].some(([, inner]) => UNTRUSTED.test(inner));

/** The lines of every `run:` script, with their line numbers. */
function scriptLines(text) {
  const lines = text.split('\n');
  const found = [];
  for (let at = 0; at < lines.length; at += 1) {
    // `run:` scripts, and actions/github-script's `script:`, which is code too.
    const run = /^(\s*)(- )?(run|script):\s*(.*)$/.exec(lines[at]);
    if (!run) continue;
    const indent = run[1].length + (run[2] ? 2 : 0);
    if (run[4] && !/^[|>]/.test(run[4])) found.push([at + 1, run[4]]);
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
    const pasted = scriptLines(text).filter(([, line]) => pastes(line));
    expect(pasted.map(([at, line]) => `${at}: ${line.trim()}`)).toEqual([]);
  });

  it('declares its token permissions', () => {
    expect(text).toMatch(/^permissions:/m);
  });
});

describe('the rule itself', () => {
  it('sees through braces inside an expression', () => {
    expect(pastes('echo "${{ format(\'{0}\', github.head_ref) }}"')).toBe(true);
    expect(pastes('echo "${{ inputs.base_url }}"')).toBe(true);
    expect(pastes('npm run e2e -- --shard=${{ matrix.shard }}/4')).toBe(false);
  });

  it('reads a github-script script as code', () => {
    const lines = scriptLines(
      [
        '      - uses: actions/github-script@v7',
        '        with:',
        '          script: |',
        '            core.info("${{ github.event.pull_request.title }}")',
      ].join('\n')
    );
    expect(lines.some(([, line]) => pastes(line))).toBe(true);
  });
});

describe('deploy.yml', () => {
  // Tests runs on pull requests too, forks included, and workflow_run's branch
  // filter matches the head branch -- so a fork's branch named main or prod
  // that passed Tests triggered a deploy holding the AWS role, of the fork's
  // commit. Only a test run from a push to this repository may deploy.
  const text = readFileSync(path.join(DIR, 'deploy.yml'), 'utf8');
  const condition = /^\s*if: >-\n((?:\s{6}.*\n)+)/m.exec(text)?.[1] ?? '';

  it('deploys only what was pushed to this repository and passed', () => {
    expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(condition).toContain("github.event.workflow_run.event == 'push'");
    expect(condition).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository'
    );
  });
});
