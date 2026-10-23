// @vitest-environment node
//
// scripts/check-move.mjs, run in a throwaway repository: a service.ts on the
// base branch, its code moved into modules in the working tree.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/check-move.mjs', import.meta.url));

const repos = [];
afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

/** The script's exit code and output: `base` committed, `head` in the tree. */
function check(base, head) {
  const repo = mkdtempSync(path.join(tmpdir(), 'move-'));
  repos.push(repo);
  const dir = path.join(repo, 'tools/content-node');
  mkdirSync(dir, { recursive: true });
  const put = (files) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  put(base);
  git('add', '.');
  // Whatever the machine's git says: this runs inside the pre-push hook.
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
  git('rm', '-q', 'tools/content-node/service.ts');
  // git rm takes the emptied directory with it.
  mkdirSync(dir, { recursive: true });
  put(head);
  const run = spawnSync(process.execPath, [SCRIPT, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  return { status: run.status, output: run.stdout + run.stderr };
}

// Two families' lists in one service, and the code that serves them.
const SERVICE = {
  'service.ts': `const aEndpoints = [{ path: '/a', handler: () => 1 }];
const bEndpoints = [{ path: '/b', handler: () => 2 }];
const endpoints = [...aEndpoints, ...bEndpoints];
export function serve() {
  return endpoints.length;
}
`,
};

// The split: each family its own module, a registry, and the server.
const split = (registry) => ({
  'a-endpoints.ts': `export const aEndpoints = [{ path: '/a', handler: () => 1 }];\n`,
  'b-endpoints.ts': `export const bEndpoints = [{ path: '/b', handler: () => 2 }];\n`,
  'registry.ts': registry,
  'server.ts': `import { endpoints } from './registry.ts';
export function serve() {
  return endpoints.length;
}
`,
});

describe('check-move', () => {
  it('passes a split that moves the code and assembles the same list', () => {
    const { status, output } = check(
      SERVICE,
      split(`import { aEndpoints } from './a-endpoints.ts';
import { bEndpoints } from './b-endpoints.ts';
export const endpoints = [...aEndpoints, ...bEndpoints];
`)
    );
    expect(output).toContain('0 changed; 0 missing; 0 added; 0 rebound');
    expect(status).toBe(0);
  });

  it('refuses a list spread under another list’s name', () => {
    // `...bEndpoints` reads the same as before; it is family a's list. The
    // spread was known by its local name only, and this passed.
    const { status, output } = check(
      SERVICE,
      split(`import { aEndpoints } from './a-endpoints.ts';
import { aEndpoints as bEndpoints } from './a-endpoints.ts';
export const endpoints = [...aEndpoints, ...bEndpoints];
`)
    );
    expect(status).toBe(1);
    expect(output).toContain('rebound: endpoints in server.ts');
  });

  it('refuses a list reordered in the registry', () => {
    const { status, output } = check(
      SERVICE,
      split(`import { aEndpoints } from './a-endpoints.ts';
import { bEndpoints } from './b-endpoints.ts';
export const endpoints = [...bEndpoints, ...aEndpoints];
`)
    );
    expect(status).toBe(1);
    expect(output).toContain('rebound: endpoints in server.ts');
  });
});
