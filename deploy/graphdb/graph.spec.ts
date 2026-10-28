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
  // Inside the container; compose publishes Bolt on loopback only. Loopback here
  // would leave the published port answering nothing.
  'dbms.default_listen_address': '0.0.0.0',
  'dbms.memory.heap.max_size': undefined,
  'dbms.memory.pagecache.size': undefined,
  'dbms.security.procedures.unrestricted': undefined,
  'dbms.config.strict_validation': 'true',
};

/**
 * The plugins it must have. The host installation has always run APOC, and the
 * services' queries were written against it; dropping it is a change to this
 * check, not to the file alone.
 */
const REQUIRED_PLUGINS = ['apoc'];

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

  const settings = g.settings ?? {};
  const plugins = Array.isArray(g.plugins) ? g.plugins : [];
  for (const required of REQUIRED_PLUGINS)
    if (!plugins.some((p) => (p as Plugin | null)?.name === required))
      found.push(`plugin ${required} is missing`);
  for (const p of plugins as (Plugin | null)[]) {
    const name = p?.name || '(unnamed plugin)';
    if (!p?.name || !p.version || !p.url || !p.sha256) {
      found.push(`plugin ${name} needs name, version, url and sha256`);
      continue;
    }
    if (!HEX64.test(p.sha256)) found.push(`plugin ${name}'s sha256 is not 64 hex characters`);
    if (!p.url.includes(p.version))
      found.push(`plugin ${name}'s url does not name its version ${p.version}`);
    const pv = parse(p.version);
    if (!pv) found.push(`plugin ${name}'s version "${p.version}" is not a version`);
    else if (version && (pv[0] !== version[0] || pv[1] !== version[1]))
      found.push(
        `plugin ${name} ${p.version} is not for Neo4j ${version[0]}.${version[1]} (neo4j.version ${g.neo4j?.version})`
      );
    const unrestricted = (settings['dbms.security.procedures.unrestricted'] ?? '').split(',');
    if (!unrestricted.map((x) => x.trim()).includes(`${p.name}.*`))
      found.push(`setting dbms.security.procedures.unrestricted does not allow ${p.name}.*`);
  }

  for (const [key, value] of Object.entries(settings)) {
    // Neo4j's names are lower case; strict validation refuses another case only
    // when the server starts, so a misnamed allowance would pass here unseen.
    if (!/^[a-z0-9_.]+$/.test(key)) found.push(`setting ${key} is not a Neo4j setting name`);
    if (typeof value !== 'string' || value.trim() === '') found.push(`setting ${key} has no value`);
  }
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

  // Each refusal in contracts/graph-json.md, as an edit of the real file, made
  // from its current values so a reviewed version change does not break them.
  const [major, minor, patch] = (parse(graph.neo4j?.version ?? '') ?? [0, 0, 0]) as number[];
  const apoc = (g: Full) => g.plugins.find((p) => p.name === 'apoc') as Required<Plugin>;
  const refusals: [string, (g: Full) => void, RegExp][] = [
    [
      'a version older than the release build',
      (g) => (g.releaseBuild = `${major}.${minor}.${patch + 1}`),
      /older than releaseBuild/,
    ],
    [
      'a version in another major',
      (g) => {
        g.neo4j.version = `${major + 1}.0.0`;
        g.neo4j.image = `neo4j:${major + 1}.0.0-community`;
      },
      /another major/,
    ],
    [
      'an image that names another version',
      (g) => (g.neo4j.image = `neo4j:${major}.${minor}.${patch + 1}-community`),
      /does not name/,
    ],
    [
      'an enterprise image',
      (g) => (g.neo4j.image = g.neo4j.image.replace('community', 'enterprise')),
      /does not name/,
    ],
    ['a missing digest', (g) => (g.neo4j.digest = ''), /digest/],
    ['a malformed digest', (g) => (g.neo4j.digest = 'sha256:abc'), /digest/],
    [
      'a plugin without a sha256',
      (g) => (apoc(g).sha256 = ''),
      /needs name, version, url and sha256/,
    ],
    [
      'a plugin with a short sha256',
      (g) => (apoc(g).sha256 = apoc(g).sha256.slice(0, 8)),
      /64 hex/,
    ],
    [
      'a plugin url for another version',
      (g) => (apoc(g).url = apoc(g).url.replaceAll(apoc(g).version, 'x.y')),
      /does not name its version/,
    ],
    [
      'a plugin for another minor',
      (g) => {
        apoc(g).version = `${major}.${minor + 1}.0.1`;
        apoc(g).url = `https://example.org/${major}.${minor + 1}.0.1/apoc.jar`;
      },
      /is not for Neo4j/,
    ],
    [
      'a plugin version with a suffix',
      (g) => {
        apoc(g).version = `${apoc(g).version}-1`;
        apoc(g).url = `${apoc(g).url}?v=${apoc(g).version}`;
      },
      /is not a version/,
    ],
    [
      'an unnamed plugin',
      (g) => g.plugins.push({ ...apoc(g), name: '' }),
      /\(unnamed plugin\) needs name/,
    ],
    ['no APOC', (g) => (g.plugins = []), /plugin apoc is missing/],
    [
      'a plugin its procedures are not allowed for',
      (g) => (g.settings['dbms.security.procedures.unrestricted'] = 'other.*'),
      /does not allow apoc/,
    ],
    [
      'another default database',
      (g) => (g.settings['dbms.default_database'] = 'neo4j'),
      /must be graph\.db/,
    ],
    [
      'a container listening on loopback only',
      (g) => (g.settings['dbms.default_listen_address'] = '127.0.0.1'),
      /must be 0\.0\.0\.0/,
    ],
    [
      'no page cache',
      (g) => delete g.settings['dbms.memory.pagecache.size'],
      /pagecache\.size is missing/,
    ],
    [
      'an empty value',
      (g) => (g.settings['dbms.memory.heap.max_size'] = ''),
      /heap\.max_size has no value/,
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
      'store upgrade standing under another case',
      (g) => (g.settings['dbms.Allow_Upgrade'] = 'true'),
      /dbms\.Allow_Upgrade is not a Neo4j setting name/,
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
    const noPlugins = problems(changed((g) => Reflect.deleteProperty(g, 'plugins'))).join('\n');
    expect(noPlugins).toMatch(/plugin apoc is missing/);
  });

  for (const [what, edit, says] of refusals)
    it(`refuses ${what}`, () => {
      const found = problems(changed(edit));
      expect(found.join('\n')).toMatch(says);
    });

  it('allows a newer version of the same major, its plugins moved with it', () => {
    const next = `${major}.${minor + 1}.0`;
    expect(
      problems(
        changed((g) => {
          g.neo4j.version = next;
          g.neo4j.image = `neo4j:${next}-community`;
          apoc(g).version = `${major}.${minor + 1}.0.1`;
          apoc(g).url = `https://example.org/${major}.${minor + 1}.0.1/apoc.jar`;
        })
      )
    ).toEqual([]);
  });
});
