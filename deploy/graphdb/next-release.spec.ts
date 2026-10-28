import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  existsSync,
  linkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  journalctl:
    '[ "${STUB_WRITES:-0}" = 1 ] && echo "Server at localhost:7687 no longer accepts writes" || true',
  ss: '[ "${STUB_PORT:-1}" = 1 ] && echo "LISTEN 0 4096 127.0.0.1:7687" || true',
  find: 'true',
  df: 'case "$*" in *-k*) printf "Avail\\n%s\\n" "${STUB_FREE_KB:-9000000}";; *) printf "Avail\\n9G\\n";; esac',
  systemctl: `case "$1 $2" in "is-active "*) [ "\${STUB_NEO4J_ACTIVE:-1}" = 1 ];; "restart tomcat9") [ "\${STUB_INT_ON_TOMCAT:-0}" = 1 ] && kill -INT $PPID; [ "\${STUB_TOMCAT_FAIL:-0}" != 1 ];; "stop neo4j") [ "\${STUB_INT_ON_STOP:-0}" = 1 ] && kill -INT $PPID; [ "\${STUB_STOP_FAIL:-0}" != 1 ];; "start neo4j") [ "\${STUB_INT_ON_START:-0}" = 1 ] && kill -INT $PPID; true;; *) true;; esac`,
  curl: `url="\${@: -1}"
case "$url" in
  *4400*) printf '{"release":"%s"}' "\${STUB_CN:-98}";;
  *4360*) printf '{"release":"%s"}' "\${STUB_JL:-98}";;
  *ContentService*) printf '%s' "\${STUB_CS:-98}";;
  *AnalysisService*) printf '%s' "\${STUB_AS:-98}";;
esac`,
  docker: `case "$1" in
  inspect) case "$*" in *Mounts*) echo "\${STUB_MOUNTS:-websiteangular_graphdb-release98} ";; *Config.Image*State.Running*) if [ -f "${scratch}/replaced" ]; then echo "reactome/graphdb_readonly:Release98 false"; else echo "\${STUB_SERVING:-local-test/graphdb:Release97-community} \${STUB_GRAPH_RUNNING:-true}"; fi;; *State.Running*) if [ -f "${scratch}/prevup" ] && [ "\${STUB_PREV_DIES:-0}" = 1 ]; then echo false; else echo "\${STUB_GRAPH_RUNNING:-true}"; fi;; *Health.Status*) echo "\${STUB_HEALTH:-healthy}";; *Config.Image*graphdb-1*) echo "\${STUB_SERVING:-local-test/graphdb:Release97-community}";; *Config.Image*) echo service-image;; *) echo "image running";; esac;;
  logs) case "$*" in *--since*) [ -f "${scratch}/prevup" ] && [ "\${STUB_PREV_DIES:-0}" = 1 ] && { echo starting; exit 0; }; [ "\${STUB_HUP_ON_WAIT:-0}" = 1 ] && { kill -HUP $PPID; echo starting; exit 0; }; [ "\${STUB_GRAPH_STARTED:-1}" = 1 ] && echo "Started." || echo "starting";; *) echo "Started.";; esac;;
  run) case "$*" in *"test -f"*) [ "\${STUB_MARKER_ERROR:-0}" = 1 ] && exit 125; [ "\${STUB_FILLED:-1}" = 1 ] && echo yes || echo no;; *:/cache*) [ "\${STUB_RUN_FAIL:-0}" = 1 ] && exit 1 || true;; *) [ "\${STUB_INT_ON_FILL:-0}" = 1 ] && kill -INT $PPID; [ "\${STUB_FILL_FAIL:-0}" = 1 ] && exit 1 || true;; esac;;
  compose) [ "\${STUB_COMPOSE_FAIL:-0}" = 1 ] && exit 1; case "$*" in *"-f docker-compose.yml -f"*"up -d --no-build graphdb"*) touch "${scratch}/prevup"; [ "\${STUB_PREV_UP_FAIL:-0}" != 1 ];; *"stop graphdb"*) [ "\${STUB_GRAPH_STOP_FAIL:-0}" != 1 ];; *"up -d graphdb"*) if [ "\${STUB_UP_FAIL:-0}" = 1 ]; then [ "\${STUB_UP_REPLACES:-1}" = 1 ] && touch "${scratch}/replaced"; exit 1; fi; true;; *"restart content-node"*) [ "\${STUB_CN_RESTART_FAIL:-0}" != 1 ];; *) true;; esac;;
  volume) case "$2" in rm) touch "${scratch}/removed";; inspect) case "$3" in *release98) [ "\${STUB_VOLUME:-0}" = 1 ] && [ ! -f "${scratch}/removed" ];; *) [ "\${STUB_PREV_VOLUME:-1}" = 1 ];; esac;; ls) echo websiteangular_graphdb-release97-community; echo websiteangular_graphdb-release98;; *) true;; esac;;
  image) [ "\${STUB_PREV_IMAGE:-1}" = 1 ];;
  ps) case "$*" in *com.docker.compose.service=graphdb*) [ -n "\${STUB_VOLUME_USERS:-}" ] && echo "$STUB_VOLUME_USERS";; esac; true;;
  images) echo public.ecr.aws/reactome/graphdb:Release98; echo local-test/graphdb:Release97-community;;
  *) true;;
esac`,
};
for (const [name, body] of Object.entries(stubs))
  writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`, {
    mode: 0o755,
  });

function run(
  command: string,
  env: Record<string, string> = {},
  before?: string,
  deadTerminal = false,
  setup?: () => void
) {
  writeFileSync(log, '');
  rmSync(join(scratch, 'state'), { force: true });
  rmSync(join(scratch, 'replaced'), { force: true });
  rmSync(join(scratch, 'old-state'), { force: true });
  rmSync(join(scratch, 'prevup'), { force: true });
  rmSync(join(scratch, 'state.release97.yml'), { recursive: true, force: true });
  rmSync(join(scratch, 'removed'), { force: true });
  rmSync(join(scratch, 'elsewhere'), { force: true });
  if (before !== undefined) writeFileSync(join(scratch, 'state'), before);
  setup?.();
  const result = spawnSync('bash', [join(__dirname, 'next-release.sh'), command], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      SUDO_USER: 'user',
      CONTENT_NODE_ENV_FILE: credentials,
      NEXT_RELEASE_STATE: join(scratch, 'state'),
      NEXT_RELEASE_OLD_STATE: join(scratch, 'old-state'),
      GRAPH_WAIT: '10',
      SERVICE_WAIT: '10',
      ...env,
    },
    encoding: 'utf8',
    // A dropped connection: every write to the terminal fails.
    ...(deadTerminal ? { stdio: ['ignore', openSync('/dev/full', 'w'), 'pipe'] } : {}),
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
  return { ...result, calls, state, raw: readFileSync(log, 'utf8') };
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
      /^docker volume create .*websiteangular_graphdb-release98/,
      /^docker run --rm --entrypoint sh -v websiteangular_graphdb-release98:\/var\/lib\/neo4j\/data .* -c touch/,
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

  it('finishes a rollback that a second Ctrl-C arrives in', () => {
    const { status, calls } = run('switch', { STUB_UP_FAIL: '1', STUB_INT_ON_START: '1' });
    expect(status).toBe(1);
    const start = at(calls, /^systemctl start neo4j/);
    expect(
      at(calls.slice(start), /^docker compose restart content-node java-library/)
    ).toBeGreaterThan(0);
    expect(at(calls.slice(start), /^systemctl restart tomcat9/)).toBeGreaterThan(0);
  });

  it('goes back on a hang-up while the graph starts, even with the terminal gone', () => {
    const { status, calls } = run('switch', { STUB_HUP_ON_WAIT: '1' }, undefined, true);
    expect(status).toBe(130);
    expect(at(calls, /^systemctl start neo4j/)).toBeGreaterThan(at(calls, /^systemctl stop neo4j/));
  });

  it('removes the new volume when interrupted while filling it, before anything is stopped', () => {
    const { status, calls } = run('switch', { STUB_INT_ON_FILL: '1' });
    expect(status).toBe(130);
    at(calls, /^docker volume rm websiteangular_graphdb-release98/);
    expect(calls.some((call) => /^systemctl stop neo4j/.test(call))).toBe(false);
  });

  it('switches as usual when the release image runs but the host database also serves', () => {
    const { status, calls } = run('switch', {
      STUB_SERVING: 'reactome/graphdb_readonly:Release98',
    });
    expect(status).toBe(0);
    at(calls, /^systemctl stop neo4j/);
  });

  it("switches as usual when the release image runs on another release's volume", () => {
    const { status, calls } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release98',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
    });
    expect(status).toBe(0);
    at(calls, /^docker compose up -d graphdb/);
  });

  it("records the release that served, going from one release's image to the next", () => {
    const { status, state } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release97',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
    });
    expect(status).toBe(0);
    expect(state).toBe('host_neo4j=inactive\nprevious_release=97');
  });

  it("goes back to the previous release's image and volume when the new one does not start", () => {
    const { status, calls, stdout } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release97',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
      STUB_UP_FAIL: '1',
    });
    expect(status).toBe(1);
    const back = at(
      calls,
      /^docker compose -f docker-compose\.yml -f .*\.release97\.yml up -d --no-build graphdb/
    );
    expect(
      at(calls.slice(back), /^docker compose restart content-node java-library/)
    ).toBeGreaterThan(0);
    expect(at(calls.slice(back), /^systemctl restart tomcat9/)).toBeGreaterThan(0);
    expect(stdout).toMatch(/release 97 serves again; docker-compose\.yml still names 98/);
    const override = readFileSync(join(scratch, 'state.release97.yml'), 'utf8');
    expect(override).toMatch(/image: reactome\/graphdb_readonly:Release97/);
    expect(override).toMatch(/- graphdb-release97:\/var\/lib\/neo4j\/data/);
  });

  it("says so, and changes nothing more, when the previous release's image is gone", () => {
    const { status, calls, stdout } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release97',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
      STUB_UP_FAIL: '1',
      STUB_PREV_IMAGE: '0',
    });
    expect(status).toBe(1);
    expect(stdout).toMatch(/nothing here to go back to/);
    expect(calls.some((call) => / -f docker-compose\.yml -f /.test(call))).toBe(false);
  });

  it('leaves the previous release running when the failed switch never replaced it', () => {
    const { status, calls, stdout } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release97',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
      STUB_UP_FAIL: '1',
      STUB_UP_REPLACES: '0',
    });
    expect(status).toBe(1);
    expect(stdout).toMatch(/release 97 already serves/);
    expect(calls.some((call) => / -f docker-compose\.yml -f /.test(call))).toBe(false);
    at(calls, /^docker compose restart content-node java-library/);
  });

  it('allows another attempt at a release after rolling back to the recorded previous one', () => {
    const { status } = run(
      'switch',
      {
        STUB_NEO4J_ACTIVE: '0',
        STUB_SERVING: 'reactome/graphdb_readonly:Release97',
        STUB_MOUNTS: 'websiteangular_graphdb-release97',
      },
      'host_neo4j=inactive\nprevious_release=97\n'
    );
    expect(status).toBe(0);
  });

  it('never records the release being switched to as the one to go back to', () => {
    const { state } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release98',
      STUB_GRAPH_RUNNING: 'false',
    });
    expect(state).toBe('host_neo4j=inactive');
  });

  it('takes in a record an earlier version left in the shared place, its well-formed lines only', () => {
    const { status, state, stdout } = run(
      'switch',
      { STUB_NEO4J_ACTIVE: '0' },
      undefined,
      false,
      () =>
        writeFileSync(
          join(scratch, 'old-state'),
          'host_neo4j=active\nrm -rf /\nprevious_release=96\n'
        )
    );
    expect(stdout).toMatch(/moved to/);
    expect(existsSync(join(scratch, 'old-state'))).toBe(false);
    // Taken in, the record says the host database served: with it inactive and an
    // earlier release's image serving, the switch is refused as stale -- the record,
    // not the junk line, is what it read.
    expect(status).toBe(2);
    expect(state).toBe('host_neo4j=active\nprevious_release=96');
  });

  it('leaves alone a record in the shared place that is a link', () => {
    const { stdout, state } = run('switch', {}, undefined, false, () => {
      writeFileSync(join(scratch, 'elsewhere'), 'previous_release=96\n');
      symlinkSync(join(scratch, 'elsewhere'), join(scratch, 'old-state'));
    });
    expect(stdout).not.toMatch(/moved to/);
    expect(state).toBe('host_neo4j=active');
  });

  it('leaves alone a record in the shared place with another link to it', () => {
    const { stdout } = run('switch', {}, undefined, false, () => {
      writeFileSync(join(scratch, 'elsewhere'), 'previous_release=96\n');
      linkSync(join(scratch, 'elsewhere'), join(scratch, 'old-state'));
    });
    expect(stdout).not.toMatch(/moved to/);
  });

  it('keeps an old file that holds no record, rather than taking in nothing', () => {
    const { stdout, state } = run('switch', {}, undefined, false, () =>
      writeFileSync(join(scratch, 'old-state'), 'not a record\n')
    );
    expect(stdout).toMatch(/holds no record; left as it is/);
    expect(existsSync(join(scratch, 'old-state'))).toBe(true);
    expect(state).toBe('host_neo4j=active');
  });

  it('shows the record still in its old place', () => {
    const { status, stdout } = run('check', {}, undefined, false, () =>
      writeFileSync(join(scratch, 'old-state'), 'host_neo4j=active\n')
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/moved on the next switch, rollback or cleanup\): host_neo4j=active/);
  });

  it('refuses a state directory someone else owns', () => {
    const { status, stderr, calls } = run('switch', { NEXT_RELEASE_STATE: '/usr/state' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/\/usr is not yours alone/);
    expect(calls).toEqual([]);
  });

  it('refuses a state directory others can write to, and changes nothing', () => {
    const shared = join(scratch, 'shared');
    mkdirSync(shared, { recursive: true });
    chmodSync(shared, 0o777);
    const { status, stderr, calls } = run('switch', { NEXT_RELEASE_STATE: join(shared, 'state') });
    expect(status).toBe(2);
    expect(stderr).toMatch(/is not yours alone/);
    expect(calls).toEqual([]);
    expect(statSync(shared).mode & 0o777).toBe(0o777);
  });

  it('stops, rather than removing the volume, when it cannot look inside it', () => {
    const { status, calls, stderr } = run('switch', { STUB_VOLUME: '1', STUB_MARKER_ERROR: '1' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/could not look inside websiteangular_graphdb-release98/);
    expect(calls.some((call) => /^docker volume rm/.test(call))).toBe(false);
  });

  it('gives up at once when the previous release stops again while starting', () => {
    const { status, stdout, raw } = run('switch', {
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release97',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
      STUB_UP_FAIL: '1',
      STUB_PREV_DIES: '1',
      GRAPH_WAIT: '1000',
    });
    expect(status).toBe(1);
    expect(stdout).toMatch(/release 97 did not start again/);
    expect(raw.split('\n').filter((line) => /^docker logs --since/.test(line)).length).toBeLessThan(
      5
    );
  });

  it('says so when it cannot write the override for the previous release', () => {
    // Its own state directory, where a directory stands in the override's place.
    const own = join(scratch, 'unwritable');
    rmSync(own, { recursive: true, force: true });
    mkdirSync(join(own, 'state.release97.yml'), { recursive: true, mode: 0o700 });
    chmodSync(own, 0o700);
    const { status, stdout } = run('switch', {
      NEXT_RELEASE_STATE: join(own, 'state'),
      STUB_NEO4J_ACTIVE: '0',
      STUB_SERVING: 'reactome/graphdb_readonly:Release97',
      STUB_MOUNTS: 'websiteangular_graphdb-release97',
      STUB_UP_FAIL: '1',
    });
    expect(status).toBe(1);
    expect(stdout).toMatch(/could not write .*state\.release97\.yml/);
  });

  it('refuses a new release while the record of what served is from an earlier switch', () => {
    const { status, stderr, calls } = run(
      'switch',
      { STUB_NEO4J_ACTIVE: '0', STUB_SERVING: 'reactome/graphdb_readonly:Release97' },
      'host_neo4j=inactive\nprevious_release=96\n'
    );
    expect(status).toBe(2);
    expect(stderr).toMatch(/run cleanup first/);
    expect(calls).toEqual([]);
  });

  it('goes back when interrupted while the host database stops', () => {
    const { status, calls } = run('switch', { STUB_INT_ON_STOP: '1' });
    expect(status).toBe(130);
    expect(at(calls, /^systemctl start neo4j/)).toBeGreaterThan(at(calls, /^systemctl stop neo4j/));
  });

  it('leaves the graph serving when interrupted after it started', () => {
    const { status, calls, stdout } = run('switch', { STUB_INT_ON_TOMCAT: '1' });
    expect(status).toBe(130);
    expect(stdout).toMatch(/interrupted: the graph serves release 98; run switch again/);
    expect(calls.some((call) => /^systemctl start neo4j/.test(call))).toBe(false);
  });

  it('removes and fills again a volume an earlier run did not finish filling', () => {
    const { status, calls } = run('switch', { STUB_VOLUME: '1', STUB_FILLED: '0' });
    expect(status).toBe(0);
    const removed = at(calls, /^docker volume rm websiteangular_graphdb-release98/);
    const refilled = at(calls, /^docker volume create .*websiteangular_graphdb-release98/);
    expect(refilled).toBeGreaterThan(removed);
    expect(at(calls, /^docker compose up -d graphdb/)).toBeGreaterThan(refilled);
  });

  it('marks, and keeps, an unmarked volume a container has already used', () => {
    const { status, calls } = run('switch', {
      STUB_VOLUME: '1',
      STUB_FILLED: '0',
      STUB_VOLUME_USERS: 'abc123',
    });
    expect(status).toBe(0);
    expect(calls.some((call) => /^docker volume rm/.test(call))).toBe(false);
    at(calls, /^docker run .*websiteangular_graphdb-release98.* -c touch/);
  });

  it('goes back once, even when the rollback itself cannot reach the graph container', () => {
    const { status, calls } = run('switch', { STUB_UP_FAIL: '1', STUB_GRAPH_STOP_FAIL: '1' });
    expect(status).toBe(1);
    expect(calls.filter((call) => /^systemctl start neo4j/.test(call))).toHaveLength(1);
    expect(calls.filter((call) => /stop graphdb/.test(call))).toHaveLength(1);
  });

  it('goes back when the host database does not stop cleanly', () => {
    const { status, calls } = run('switch', { STUB_STOP_FAIL: '1' });
    expect(status).toBe(1);
    at(calls, /^systemctl start neo4j/);
    expect(calls.some((call) => /up -d graphdb/.test(call))).toBe(false);
  });

  it('removes a volume it could not fill, so a second run fills it again', () => {
    const { status, calls, stderr } = run('switch', { STUB_FILL_FAIL: '1' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/could not fill websiteangular_graphdb-release98; it is removed/);
    at(calls, /^docker volume rm websiteangular_graphdb-release98/);
    expect(calls.some((call) => /^systemctl stop neo4j/.test(call))).toBe(false);
  });

  it('on a second run, restarts and checks the services without touching the graph', () => {
    const { status, calls, stdout } = run(
      'switch',
      { STUB_NEO4J_ACTIVE: '0', STUB_SERVING: 'reactome/graphdb_readonly:Release98' },
      'host_neo4j=active\n'
    );
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/the graph already serves release 98/);
    at(calls, /^docker compose restart content-node/);
    at(calls, /^systemctl restart tomcat9/);
    expect(calls.some((call) => /graphdb|neo4j/.test(call))).toBe(false);
  });

  it('goes back when Tomcat or content-node cannot be restarted', () => {
    for (const env of [{ STUB_TOMCAT_FAIL: '1' }, { STUB_CN_RESTART_FAIL: '1' }]) {
      const { status, calls } = run('switch', env);
      expect(status).toBe(1);
      at(calls, /^systemctl start neo4j/);
    }
  });

  it('restarts the services on the host database it went back to, once that listens', () => {
    const { calls, stdout } = run('switch', { STUB_CN: '97' });
    const start = at(calls, /^systemctl start neo4j/);
    expect(
      at(calls.slice(start), /^docker compose restart content-node java-library/)
    ).toBeGreaterThan(0);
    // Figures made from the release being left are dropped too.
    expect(
      at(calls.slice(start), /^docker run .*websiteangular_render-cache:\/cache/)
    ).toBeGreaterThan(0);
    expect(stdout).toMatch(/host database listening on 7687/);
    const deaf = run('switch', { STUB_CN: '97', STUB_PORT: '0' });
    expect(deaf.stdout).toMatch(/nothing listening on 7687/);
  });

  it('says when a web application tried to write to the read-only graph', () => {
    const { status, stdout } = run('switch', { STUB_WRITES: '1' });
    expect(status).toBe(0);
    expect(stdout).toMatch(/WARNING: a web application tried to write/);
  });

  it('refuses a new release while the host database record is from an earlier switch', () => {
    const stale = run(
      'switch',
      { STUB_NEO4J_ACTIVE: '0', STUB_SERVING: 'reactome/graphdb_readonly:Release97' },
      'host_neo4j=active\n'
    );
    expect(stale.status).toBe(2);
    expect(stale.stderr).toMatch(/run cleanup first/);
    expect(stale.calls).toEqual([]);
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
    const { status, state } = run(
      'switch',
      { STUB_NEO4J_ACTIVE: '0', STUB_SERVING: 'reactome/graphdb_readonly:Release98' },
      'host_neo4j=active\n'
    );
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
