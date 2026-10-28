import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The release switch (deploy/graphdb/next-release.sh), run with stand-ins for
 * every command that would touch the host: each logs its arguments, and answers
 * as the case asks. What is checked is the order of what it would do, and that
 * it goes back by itself when the new release does not come up.
 */
const scratch = mkdtempSync(join(tmpdir(), 'next-release-'));
const bin = join(scratch, 'bin');
mkdirSync(bin);
const log = join(scratch, 'calls.log');
const credentials = join(scratch, 'content-node.env');
writeFileSync(credentials, 'NEO4J_USER=neo4j\n');

const stubs: Record<string, string> = {
  id: 'echo "${STUB_UID:-0}"',
  getent: `echo "user:x:1000:1000::${scratch}:/bin/bash"`,
  sleep: 'true',
  journalctl: 'true',
  ss: '[ "${STUB_PORT:-1}" = 1 ] && echo "LISTEN 0 4096 127.0.0.1:7687" || true',
  find: 'true',
  df: 'case "$*" in *-k*) printf "Avail\\n%s\\n" "${STUB_FREE_KB:-9000000}";; *) printf "Avail\\n9G\\n";; esac',
  systemctl: `case "$1" in is-active) [ "\${STUB_NEO4J_ACTIVE:-1}" = 1 ];; *) true;; esac`,
  curl: `url="\${@: -1}"
case "$url" in
  *4400*) printf '{"release":"%s"}' "\${STUB_CN:-98}";;
  *4360*) printf '{"release":"%s"}' "\${STUB_JL:-98}";;
  *ContentService*) printf '%s' "\${STUB_CS:-98}";;
  *AnalysisService*) printf '%s' "\${STUB_AS:-98}";;
esac`,
  docker: `case "$1" in
  inspect) case "$*" in *State.Running*) echo "\${STUB_GRAPH_RUNNING:-true}";; *Health.Status*) echo "\${STUB_HEALTH:-healthy}";; *Config.Image*) echo service-image;; *) echo "image running";; esac;;
  logs) case "$*" in *--since*) [ "\${STUB_GRAPH_STARTED:-1}" = 1 ] && echo "Started." || echo "starting";; *) echo "Started.";; esac;;
  run) [ "\${STUB_RUN_FAIL:-0}" = 1 ] && exit 1 || true;;
  compose) case "$*" in *"up -d graphdb"*) [ "\${STUB_UP_FAIL:-0}" = 1 ] && exit 1 || true;; *) true;; esac;;
  volume) case "$2" in inspect) [ "\${STUB_VOLUME:-0}" = 1 ];; ls) echo websiteangular_graphdb-release97-community; echo websiteangular_graphdb-release98;; *) true;; esac;;
  images) echo public.ecr.aws/reactome/graphdb:Release98; echo local-test/graphdb:Release97-community;;
  *) true;;
esac`,
};
for (const [name, body] of Object.entries(stubs))
  writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`, {
    mode: 0o755,
  });

function run(command: string, env: Record<string, string> = {}, before?: string) {
  writeFileSync(log, '');
  rmSync(join(scratch, 'state'), { force: true });
  if (before !== undefined) writeFileSync(join(scratch, 'state'), before);
  const result = spawnSync('bash', [join(__dirname, 'next-release.sh'), command], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      SUDO_USER: 'user',
      CONTENT_NODE_ENV_FILE: credentials,
      NEXT_RELEASE_STATE: join(scratch, 'state'),
      GRAPH_WAIT: '10',
      SERVICE_WAIT: '10',
      ...env,
    },
    encoding: 'utf8',
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(
      (line) => /^(docker|systemctl) /.test(line) && !/ (inspect|logs|is-active) /.test(line)
    );
  let state = '';
  try {
    state = readFileSync(join(scratch, 'state'), 'utf8').trim();
  } catch {
    // no record written
  }
  return { ...result, calls, state };
}

/** The position of the first call matching `pattern`, failing the test if there is none. */
function at(calls: string[], pattern: RegExp): number {
  const index = calls.findIndex((call) => pattern.test(call));
  expect(index, `no call matching ${pattern}:\n${calls.join('\n')}`).toBeGreaterThanOrEqual(0);
  return index;
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the release switch', () => {
  it('moves to the release compose names, then restarts and clears each holder, in order', () => {
    const { status, calls, stdout } = run('switch');
    expect(status, stdout).toBe(0);
    const order = [
      /^docker compose build --pull graphdb/,
      /^docker compose up --no-start graphdb/,
      /^systemctl stop neo4j/,
      /^systemctl disable neo4j/,
      /^docker compose up -d graphdb/,
      /^docker compose restart content-node/,
      /^docker compose stop java-library/,
      /^docker run .*websiteangular_java-library-cache:\/cache/,
      /^docker compose up -d java-library/,
      /^docker compose stop render/,
      /^docker run .*websiteangular_render-cache:\/cache/,
      /^docker compose up -d render/,
      /^systemctl restart tomcat9/,
    ].map((pattern) => at(calls, pattern));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(stdout).toMatch(/Done: release 98/);
    expect(stdout).toMatch(/Purge the edge cache by prefix \/ContentService\//);
  });

  it('goes back to the host database when the graph does not start', () => {
    const { status, calls, stdout } = run('switch', {
      STUB_GRAPH_STARTED: '0',
      STUB_GRAPH_RUNNING: 'false',
    });
    expect(status).toBe(1);
    expect(stdout).toMatch(/the graph did not start/);
    expect(at(calls, /^systemctl start neo4j/)).toBeGreaterThan(
      at(calls, /^docker compose stop graphdb/)
    );
    expect(calls.some((call) => /tomcat9/.test(call) && /restart/.test(call))).toBe(true);
  });

  it('goes back when the graph cannot even be started, after the host database stopped', () => {
    const { status, calls } = run('switch', { STUB_UP_FAIL: '1' });
    expect(status).toBe(1);
    expect(at(calls, /^systemctl start neo4j/)).toBeGreaterThan(at(calls, /^systemctl stop neo4j/));
    at(calls, /^systemctl restart tomcat9/);
  });

  it('goes back when a cache cannot be cleared', () => {
    const { status, stdout, calls } = run('switch', { STUB_RUN_FAIL: '1' });
    expect(status).toBe(1);
    expect(stdout).toMatch(/could not clear websiteangular_java-library-cache/);
    at(calls, /^systemctl start neo4j/);
  });

  it('goes back when render does not come back healthy', () => {
    const { status, stdout } = run('switch', { STUB_HEALTH: 'unhealthy' });
    expect(status).toBe(1);
    expect(stdout).toMatch(/render is unhealthy, not healthy/);
  });

  it("keeps the first switch's record on a second switch, so rollback still reaches the host", () => {
    const { status, state } = run('switch', { STUB_NEO4J_ACTIVE: '0' }, 'host_neo4j=active\n');
    expect(status).toBe(0);
    expect(state).toBe('host_neo4j=active');
  });

  it('leaves the graph running when there is no host database to go back to', () => {
    for (const before of ['host_neo4j=inactive\n', undefined]) {
      const { status, calls, stdout } = run('rollback', {}, before);
      expect(status).toBe(1);
      expect(stdout).toMatch(/nothing here to go back to/);
      expect(calls).toEqual([]);
    }
  });

  it('goes back when content-node still answers the previous release', () => {
    const { status, calls, stdout } = run('switch', { STUB_CN: '97' });
    expect(status).toBe(1);
    expect(stdout).toMatch(/content_node answers 97, not 98/);
    at(calls, /^systemctl start neo4j/);
    expect(calls.some((call) => /render-cache/.test(call))).toBe(false);
  });

  it('says how to go back when the host database was not what served', () => {
    const { status, stdout } = run('switch', { STUB_NEO4J_ACTIVE: '0', STUB_CN: '97' });
    expect(status).toBe(1);
    expect(stdout).toMatch(/check out its docker-compose\.yml and run switch again/);
  });

  it('changes nothing without root', () => {
    const { status, calls, stderr } = run('switch', { STUB_UID: '1000' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/run with sudo/);
    expect(calls).toEqual([]);
  });

  it('refuses before any change when the new volume would not fit', () => {
    const { status, calls, stderr } = run('switch', { STUB_FREE_KB: '1000000' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/under 5 GB free/);
    expect(calls).toEqual([]);
  });

  it('removes the previous releases only while the new one is served', () => {
    const refused = run('cleanup', { STUB_CN: '97' });
    expect(refused.status).toBe(2);
    expect(refused.calls).toEqual([]);
    const { status, calls } = run('cleanup');
    expect(status).toBe(0);
    expect(calls).toContain('docker volume rm websiteangular_graphdb-release97-community');
    expect(calls).toContain('docker rmi local-test/graphdb:Release97-community');
    expect(calls.some((call) => /release98|Release98/.test(call) && /rm/.test(call))).toBe(false);
  });
});
