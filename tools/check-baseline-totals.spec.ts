// @vitest-environment node
//
// scripts/check-baseline-totals.mjs, run in a throwaway repository: the base
// branch's baselines committed, the pull request's in the working tree.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Inside a worktree's pre-push hook git exports GIT_DIR and the like, and the
// throwaway repositories below then acted on the worktree instead ("this operation
// must be run in a work tree"). They are this process's to lose.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];

const SCRIPT = fileURLToPath(new URL('../scripts/check-baseline-totals.mjs', import.meta.url));
const LINT = { rules: { 'no-unused-vars': 3 } };
const DEAD = { total: 5 };

const repos: string[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

/** A baseline: module name to count. */
type Baseline = Record<string, number>;
type Baselines = { loose: Baseline; implicitAny: Baseline };

function write(repo: string, { loose, implicitAny }: Baselines) {
  writeFileSync(path.join(repo, 'tools/loose-baseline.json'), JSON.stringify(loose));
  writeFileSync(path.join(repo, 'tools/implicit-any-baseline.json'), JSON.stringify(implicitAny));
}

/** The script's exit code and output: `base` committed, `head` in the tree. */
function check(base: Baselines, head: Baselines) {
  const repo = mkdtempSync(path.join(tmpdir(), 'totals-'));
  repos.push(repo);
  mkdirSync(path.join(repo, 'tools'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  write(repo, base);
  writeFileSync(path.join(repo, 'lint-baseline.json'), JSON.stringify(LINT));
  writeFileSync(path.join(repo, 'dead-code-baseline.json'), JSON.stringify(DEAD));
  git('add', '.');
  // Whatever the machine's git says: this runs inside the pre-push hook, where
  // a signing prompt would hang it and a global hook would run on a throwaway.
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '--no-verify',
    '-m',
    'base'
  );
  write(repo, head);
  const run = spawnSync(process.execPath, [SCRIPT, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  return { status: run.status, output: run.stdout + run.stderr };
}

const BASE = {
  loose: { 'tools/render/pptx.ts': 192 },
  implicitAny: { 'tools/render/pptx.ts': 72 },
};

describe('check-baseline-totals', () => {
  it('passes typing, which lowers a module and the total', () => {
    expect(
      check(BASE, {
        loose: { 'tools/render/pptx.ts': 180 },
        implicitAny: { 'tools/render/pptx.ts': 72 },
      }).status
    ).toBe(0);
  });

  it('refuses a module at zero -- absent from the base -- rising behind a fall elsewhere', () => {
    // Every typed module leaves the baseline, so the base does not list it;
    // the total is unchanged, and only the module says what happened.
    const { status, output } = check(BASE, {
      loose: { 'tools/render/pptx.ts': 187, 'tools/content-node/graph.ts': 5 },
      implicitAny: { 'tools/render/pptx.ts': 70, 'tools/content-node/domain.ts': 2 },
    });
    expect(status).toBe(1);
    expect(output).toContain('loose in tools/content-node/graph.ts rose: 5, base 0');
    expect(output).toContain('implicit any in tools/content-node/domain.ts rose: 2, base 0');
  });

  it('refuses a family module rising behind a fall elsewhere, as any other', () => {
    const { status, output } = check(
      {
        loose: { 'tools/render/pptx.ts': 192, 'tools/content-node/search-endpoints.ts': 10 },
        implicitAny: BASE.implicitAny,
      },
      {
        loose: { 'tools/render/pptx.ts': 190, 'tools/content-node/search-endpoints.ts': 12 },
        implicitAny: BASE.implicitAny,
      }
    );
    expect(status).toBe(1);
    expect(output).toContain('search-endpoints.ts rose: 12, base 10');
  });

  it('refuses a rise in the total', () => {
    const { status, output } = check(BASE, {
      loose: { 'tools/render/pptx.ts': 193 },
      implicitAny: BASE.implicitAny,
    });
    expect(status).toBe(1);
    expect(output).toContain('loose rose: 193, base 192');
  });
});
