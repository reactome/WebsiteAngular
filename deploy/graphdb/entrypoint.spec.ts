import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The graph database's start-up wrapper: it turns authentication on with the
 * credentials the services already hold, read from their file literally.
 *
 * Run with the image's own entrypoint swapped for a printer, so what is checked
 * is exactly what Neo4j would have been handed.
 */
const scratch = mkdtempSync(join(tmpdir(), 'graphdb-entrypoint-'));
const printer = join(scratch, 'print.sh');
writeFileSync(
  printer,
  '#!/bin/bash\nprintf "%s\\n%s\\n%s" "$NEO4J_AUTH" "$NEO4J_dbms_security_auth__enabled" "$*"\n',
  {
    mode: 0o755,
  }
);

function start(credentials: string) {
  const file = join(scratch, 'graphdb.env');
  writeFileSync(file, credentials);
  return spawnSync('bash', [join(__dirname, 'entrypoint.sh'), 'neo4j'], {
    env: { PATH: process.env['PATH'] ?? '', GRAPHDB_CREDENTIALS_FILE: file, GRAPHDB_EXEC: printer },
    encoding: 'utf8',
  });
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the graph database wrapper', () => {
  it('turns authentication on with the file’s user and password', () => {
    const run = start('NEO4J_URI=bolt://127.0.0.1:7687\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=plain\n');
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('neo4j/plain\ntrue\nneo4j');
  });

  it('keeps a password exactly, whatever a shell would make of it', () => {
    // Characters a shell or an env_file parser would expand, split or strip.
    const password = `a$HOME"b'c d=e\\f\`g`;
    const run = start(`NEO4J_USER=neo4j\nNEO4J_PASSWORD=${password}\n`);
    expect(run.stdout.split('\n')[0]).toBe(`neo4j/${password}`);
  });

  it('reads the file as graph.mjs does: comments skipped, keys and values trimmed', () => {
    const run = start(
      '# NEO4J_PASSWORD=commented\n  NEO4J_USER = neo4j  \nNEO4J_PASSWORD=  spaced  \n'
    );
    expect(run.stdout.split('\n')[0]).toBe('neo4j/spaced');
  });

  it('reads a last line with no newline', () => {
    const run = start('NEO4J_USER=neo4j\nNEO4J_PASSWORD=last');
    expect(run.stdout.split('\n')[0]).toBe('neo4j/last');
  });

  // What the image's own entrypoint cannot take. Given any of these it either
  // prints NEO4J_AUTH -- password included -- to the container log, or exits,
  // or (a password ending /true) makes the password expire on first use.
  for (const [what, credentials] of [
    ['a password with a slash', 'NEO4J_USER=neo4j\nNEO4J_PASSWORD=pa/ss\n'],
    ['a password ending /true', 'NEO4J_USER=neo4j\nNEO4J_PASSWORD=pass/true\n'],
    ['a user other than neo4j', 'NEO4J_USER=reader\nNEO4J_PASSWORD=secret\n'],
    ['the default password', 'NEO4J_USER=neo4j\nNEO4J_PASSWORD=neo4j\n'],
  ]) {
    it(`refuses ${what}, without printing it`, () => {
      const run = start(credentials ?? '');
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).not.toMatch(/secret|pa\/ss|pass\/true|NEO4J_PASSWORD=/);
      expect(run.stderr).toMatch(/graphdb:/);
    });
  }

  for (const [what, credentials] of [
    ['no password', 'NEO4J_USER=neo4j\n'],
    ['an empty password', 'NEO4J_USER=neo4j\nNEO4J_PASSWORD=\n'],
    ['no user', 'NEO4J_PASSWORD=x\n'],
  ]) {
    it(`refuses to start, rather than start open, with ${what}`, () => {
      const run = start(credentials ?? '');
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/not starting without authentication/);
    });
  }

  describe("handing over to the image's own entrypoint", () => {
    // Images differ: Reactome's 4.3 image starts /sbin/tini and
    // /docker-entrypoint.sh, the 4.4 one tini from /usr/bin and
    // /startup/docker-entrypoint.sh. The wrapper hard-coded the first, and the
    // second restart-looped on "/sbin/tini: No such file or directory".
    const bin = join(scratch, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'tini'), '#!/bin/bash\nprintf "%s|" "$@"\n', { mode: 0o755 });

    function hand(entrypoints: string) {
      const file = join(scratch, 'graphdb.env');
      writeFileSync(file, 'NEO4J_USER=neo4j\nNEO4J_PASSWORD=secret\n');
      return spawnSync('bash', [join(__dirname, 'entrypoint.sh'), 'neo4j'], {
        env: {
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          GRAPHDB_CREDENTIALS_FILE: file,
          GRAPHDB_ENTRYPOINTS: entrypoints,
        },
        encoding: 'utf8',
      });
    }

    it('runs tini from the PATH with the first entrypoint the image has', () => {
      const present = join(scratch, 'docker-entrypoint.sh');
      writeFileSync(present, '');
      const run = hand(`${join(scratch, 'startup', 'docker-entrypoint.sh')}:${present}`);
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(`-g|--|${present}|neo4j|`);
    });

    it('says so and stops when the image has none of them', () => {
      const run = hand(join(scratch, 'nowhere', 'docker-entrypoint.sh'));
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/graphdb: no entrypoint/);
    });
  });
});
