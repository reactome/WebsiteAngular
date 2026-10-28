import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What the graph is to run (spec 017, FR-012; contracts/graph-json.md).
 *
 * A server opens a store from its own version or an earlier one of the same
 * major, and changes it so that the earlier version can no longer start: a
 * 4.4 start upgraded a 4.3 system database, after which 4.3 refused to start
 * at all (research R2). So a version older than the release's, or of another
 * major, is refused here, before any host is asked to run it. The settings
 * that let a damaged or older store start are for one start of one step, and
 * never stand: left on, a store that lost its logs starts without a word.
 */

// As read from a hand-edited file: any field may be missing, and each check says which.
interface Plugin {
  name?: string;
  version?: string;
  url?: string;
  sha256?: string;
}

interface Graph {
  neo4j?: { version?: string; image?: string; digest?: string };
  releaseBuild?: string;
  plugins?: Plugin[];
  settings?: Record<string, string>;
}

const file = join(__dirname, 'graph.json');
const graph = JSON.parse(readFileSync(file, 'utf8')) as Graph;

/** The settings a standing configuration must never hold. */
const ALLOWANCES = [
  'dbms.allow_upgrade',
  'dbms.recovery.fail_on_missing_files',
  'unsupported.dbms.tx_log.fail_on_corrupted_log_files',
];

/** The settings it must hold, with the value each must have where one is required. */
const REQUIRED: Record<string, string | undefined> = {
  'dbms.default_database': 'graph.db',
  'dbms.default_listen_address': undefined,
  'dbms.memory.heap.max_size': undefined,
  'dbms.memory.pagecache.size': undefined,
  'dbms.security.procedures.unrestricted': undefined,
  'dbms.config.strict_validation': 'true',
};

const HEX64 = /^[0-9a-f]{64}$/;

function parse(version: string): number[] | undefined {
  return /^\d+(\.\d+){1,3}$/.test(version) ? version.split('.').map(Number) : undefined;
}

function older(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** Everything wrong with a configuration, each naming what to fix; empty when it may run. */
function problems(g: Graph): string[] {
  const found: string[] = [];
  const version = parse(g.neo4j?.version ?? '');
  const build = parse(g.releaseBuild ?? '');
  if (!version) found.push(`neo4j.version "${g.neo4j?.version}" is not a version`);
  if (!build) found.push(`releaseBuild "${g.releaseBuild}" is not a version`);
  if (version && build) {
    if (version[0] !== build[0])
      found.push(
        `neo4j.version ${g.neo4j?.version} is in another major than releaseBuild ${g.releaseBuild}: a migration, not an apply (FR-008)`
      );
    else if (older(version, build))
      found.push(
        `neo4j.version ${g.neo4j?.version} is older than releaseBuild ${g.releaseBuild}: the server could not open the release's store`
      );
  }
  if (g.neo4j?.image !== `neo4j:${g.neo4j?.version}-community`)
    found.push(`neo4j.image ${g.neo4j?.image} does not name neo4j.version ${g.neo4j?.version}`);
  if (!/^sha256:[0-9a-f]{64}$/.test(g.neo4j?.digest ?? ''))
    found.push('neo4j.digest is missing or not a sha256 digest');

  for (const p of g.plugins ?? []) {
    const name = p.name || '(unnamed plugin)';
    if (!p.version || !p.url || !p.sha256)
      found.push(`plugin ${name} needs version, url and sha256`);
    else if (!HEX64.test(p.sha256)) found.push(`plugin ${name}'s sha256 is not 64 hex characters`);
    if (p.version && !p.url?.includes(p.version))
      found.push(`plugin ${name}'s url does not name its version ${p.version}`);
    const pv = parse(p.version ?? '');
    if (version && pv && (pv[0] !== version[0] || pv[1] !== version[1]))
      found.push(
        `plugin ${name} ${p.version} is not for Neo4j ${version[0]}.${version[1]} (neo4j.version ${g.neo4j?.version})`
      );
  }

  const settings = g.settings ?? {};
  for (const [key, value] of Object.entries(REQUIRED)) {
    if (!(key in settings)) found.push(`setting ${key} is missing`);
    else if (value !== undefined && settings[key] !== value)
      found.push(`setting ${key} must be ${value}, not ${settings[key]}`);
  }
  for (const key of ALLOWANCES)
    if (key in settings)
      found.push(
        `setting ${key} is never in the standing configuration (FR-003): the first two are for one start of one step, the third for none`
      );
  return found;
}

/** The real file, which has every field, as the edits below expect. */
interface Full {
  neo4j: { version: string; image: string; digest: string };
  releaseBuild: string;
  plugins: Required<Plugin>[];
  settings: Record<string, string>;
}

/** The configuration with one change, as a one-line edit of graph.json would make it. */
function changed(edit: (g: Full) => void): Graph {
  const copy = structuredClone(graph) as Full;
  edit(copy);
  return copy;
}

describe('the graph configuration', () => {
  it('may run as it stands', () => {
    expect(problems(graph)).toEqual([]);
  });

  // Each refusal in contracts/graph-json.md, on a one-line change of the real file.
  const refusals: [string, (g: Full) => void, RegExp][] = [
    [
      'a version older than the release build',
      (g) => {
        g.neo4j.version = '4.3.5';
        g.neo4j.image = 'neo4j:4.3.5-community';
      },
      /older than releaseBuild/,
    ],
    [
      'a version in another major',
      (g) => {
        g.neo4j.version = '5.26.0';
        g.neo4j.image = 'neo4j:5.26.0-community';
      },
      /another major/,
    ],
    [
      'an image that names another version',
      (g) => (g.neo4j.image = 'neo4j:4.4.48-community'),
      /does not name/,
    ],
    ['a missing digest', (g) => (g.neo4j.digest = ''), /digest/],
    ['a malformed digest', (g) => (g.neo4j.digest = 'sha256:abc'), /digest/],
    [
      'a plugin without a sha256',
      (g) => (g.plugins[0].sha256 = ''),
      /needs version, url and sha256/,
    ],
    ['a plugin with a short sha256', (g) => (g.plugins[0].sha256 = 'a59fc337'), /64 hex/],
    [
      'a plugin url for another version',
      (g) => (g.plugins[0].url = g.plugins[0].url.replaceAll('4.3.0.12', '4.3.0.11')),
      /does not name its version/,
    ],
    [
      'a plugin for another minor',
      (g) => (g.plugins[0].version = '4.4.0.40'),
      /not for Neo4j 4\.3/,
    ],
    [
      'another default database',
      (g) => (g.settings['dbms.default_database'] = 'neo4j'),
      /must be graph\.db/,
    ],
    [
      'no page cache',
      (g) => delete g.settings['dbms.memory.pagecache.size'],
      /pagecache\.size is missing/,
    ],
    [
      'strict validation off',
      (g) => (g.settings['dbms.config.strict_validation'] = 'false'),
      /must be true/,
    ],
    [
      'store upgrade standing',
      (g) => (g.settings['dbms.allow_upgrade'] = 'true'),
      /allow_upgrade is never in the standing/,
    ],
    [
      'missing logs tolerated standing',
      (g) => (g.settings['dbms.recovery.fail_on_missing_files'] = 'false'),
      /fail_on_missing_files is never in the standing/,
    ],
    [
      'corrupted logs tolerated standing',
      (g) => (g.settings['unsupported.dbms.tx_log.fail_on_corrupted_log_files'] = 'false'),
      /fail_on_corrupted_log_files is never in the standing/,
    ],
  ];
  it('names a missing section rather than failing on it', () => {
    const found = problems(changed((g) => Reflect.deleteProperty(g, 'neo4j'))).join('\n');
    expect(found).toMatch(/neo4j\.version "undefined" is not a version/);
    expect(found).toMatch(/digest is missing/);
  });

  for (const [what, edit, says] of refusals)
    it(`refuses ${what}`, () => {
      const found = problems(changed(edit));
      expect(found.join('\n')).toMatch(says);
    });

  it('allows a newer version of the same major', () => {
    expect(
      problems(
        changed((g) => {
          g.neo4j.version = '4.4.48';
          g.neo4j.image = 'neo4j:4.4.48-community';
          g.plugins[0].version = '4.4.0.40';
          g.plugins[0].url = g.plugins[0].url.replaceAll('4.3.0.12', '4.4.0.40');
        })
      )
    ).toEqual([]);
  });
});
