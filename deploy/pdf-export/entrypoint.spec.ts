// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The PDF service's entrypoint (deploy/pdf-export/entrypoint.sh): the graph's
 * settings from the credentials file, read literally as content-node and the
 * library service read it, never sourced. Run here under bash, with `env` as
 * the command, so what the service would be started with can be read back.
 */
const script = join(__dirname, 'entrypoint.sh');
const work = mkdtempSync(join(tmpdir(), 'pdf-entrypoint-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The NEO4J_* (and SOLR_*) settings the command is started with, from a file of these lines. */
function started(lines: string, environment: Record<string, string> = {}) {
  const file = join(work, `env-${Math.random().toString(36).slice(2)}`);
  writeFileSync(file, lines);
  const run = spawnSync('bash', [script, 'env'], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', PDF_EXPORT_ENV_FILE: file, ...environment },
  });
  const settings: Record<string, string> = {};
  for (const line of run.stdout.split('\n')) {
    const at = line.indexOf('=');
    if (line.startsWith('NEO4J_') || line.startsWith('SOLR_'))
      settings[line.slice(0, at)] = line.slice(at + 1);
  }
  return { status: run.status, settings, stderr: run.stderr };
}

describe('the PDF service’s entrypoint', () => {
  it('takes a password exactly as written: nothing a shell would eat or expand', () => {
    const password = `a$HOME"b'c\`id\`;d #e\\f=g$(echo x)`;
    expect(started(`NEO4J_USER=reader\nNEO4J_PASSWORD=${password}\n`).settings).toEqual({
      NEO4J_USER: 'reader',
      NEO4J_PASSWORD: password,
    });
  });

  it('reads lines as the other readers do: trimmed, comments and keyless lines skipped', () => {
    const { settings } = started(
      [
        '# NEO4J_USER=commented',
        '   # NEO4J_DATABASE=commented too',
        '=NEO4J_URI=no key',
        'no equals sign',
        '  NEO4J_USER  =  spaced  ',
        'NEO4J_PASSWORD=last line, no newline\r',
      ].join('\n')
    );
    expect(settings).toEqual({ NEO4J_USER: 'spaced', NEO4J_PASSWORD: 'last line, no newline' });
  });

  it('takes the graph’s four settings only, and the environment’s where it gives one', () => {
    const { settings } = started(
      'NEO4J_URI=bolt://elsewhere:7687\nNEO4J_DATABASE=other\nSOLR_PASSWORD=not this\nNEO4J_USER=reader\n',
      { NEO4J_URI: 'bolt://127.0.0.1:7687', NEO4J_USER: '' }
    );
    expect(settings).toEqual({
      NEO4J_URI: 'bolt://127.0.0.1:7687',
      NEO4J_DATABASE: 'other',
      // An empty one is none: the file's is taken.
      NEO4J_USER: 'reader',
    });
  });

  it('refuses to start when the file it is given cannot be read', () => {
    const run = spawnSync('bash', [script, 'true'], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', PDF_EXPORT_ENV_FILE: join(work, 'missing') },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('cannot be read');
  });

  it('starts the command as it is without a file', () => {
    const run = spawnSync('bash', [script, 'echo', 'started'], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '' },
    });
    expect([run.status, run.stdout]).toEqual([0, 'started\n']);
  });
});
