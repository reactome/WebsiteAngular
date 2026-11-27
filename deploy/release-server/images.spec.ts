// @vitest-environment node
//
// The images a server pulls are the ones CI publishes (specs/032 R1, T011):
// every compose service built from a Dockerfile publish-images.yml publishes
// names that image, `${REGISTRY:-registry.invalid}/<name>:${IMAGE_TAG:-main}`, so
// `docker compose pull` fetches it on a server and `docker compose build`
// builds it on beta. A name that drifts from the workflow's pulls nothing, or
// another image; a service the workflow never publishes (java-library,
// pdf-export) must not name the registry at all. On a server, the override
// in contracts/compose-override.md resets each published service's `build:`
// and requires REGISTRY and IMAGE_TAG (`:?`), so it never builds one and never
// falls back to this file's defaults; and every deployment's nginx is
// published.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Document, isMap, isScalar, parse, parseDocument } from 'yaml';

const ROOT = join(__dirname, '../..');

type Mapping = { [key: string]: unknown };
const isMapping = (node: unknown): node is Mapping =>
  node !== null && typeof node === 'object' && !Array.isArray(node);
const mappingOf = (node: unknown): Mapping => (isMapping(node) ? node : {});
const listOf = (node: unknown): unknown[] => (Array.isArray(node) ? node : []);
const textOf = (node: unknown): string => (typeof node === 'string' ? node : '');
const read = (path: string): Mapping => mappingOf(parse(readFileSync(join(ROOT, path), 'utf8')));

/** One leg of the publish job: an image name, its Dockerfile, its build arguments. */
interface Published {
  name: string;
  dockerfile: string;
  args: Map<string, string>;
}

/** What the workflow publishes, leg by leg. */
function published(workflow: Mapping): Published[] {
  const publish = mappingOf(mappingOf(workflow['jobs'])['publish']);
  const legs = listOf(mappingOf(mappingOf(publish['strategy'])['matrix'])['include']);
  return legs.map(mappingOf).map((leg) => ({
    name: textOf(leg['name']),
    dockerfile: posix.normalize(textOf(leg['dockerfile'])),
    args: new Map(
      textOf(leg['build-args'])
        .split(/\s+/)
        .filter(Boolean)
        .map((arg): [string, string] => {
          const at = arg.indexOf('=');
          return [arg.slice(0, at), arg.slice(at + 1)];
        })
    ),
  }));
}

/** A compose service's Dockerfile, from the repository's root. */
function dockerfileOf(service: Mapping): string | undefined {
  const build = service['build'];
  if (build === undefined) return undefined;
  if (typeof build === 'string') return posix.join(build, 'Dockerfile');
  const context = textOf(mappingOf(build)['context']) || '.';
  return posix.join(context, textOf(mappingOf(build)['dockerfile']) || 'Dockerfile');
}

/**
 * The `image:` a service built from `dockerfile` must name, or a reason it
 * cannot. One leg without build arguments: its name. Several legs, one per
 * value of a build argument (nginx's NGINX_ENV): the argument's own variable
 * in the name, with the default the service builds with, so the image pulled
 * is the one the service's build would make.
 */
function expected(service: Mapping, legs: Published[]): string {
  const image = (name: string) => `\${REGISTRY:-registry.invalid}/${name}:\${IMAGE_TAG:-main}`;
  const [only] = legs;
  if (legs.length === 1 && only?.args.size === 0) return image(only.name);
  const keys = new Set(legs.flatMap((leg) => [...leg.args.keys()]));
  const [key] = keys;
  if (keys.size !== 1 || key === undefined)
    return `one build argument, not ${[...keys].join(', ')}`;
  const arg = textOf(mappingOf(mappingOf(service['build'])['args'])[key]);
  const variable = /^\$\{(\w+):-([\w-]+)\}$/.exec(arg);
  if (!variable) return `${key} built from a variable with a default, not "${arg}"`;
  const [, name = '', fallback = ''] = variable;
  const values = legs.map((leg) => leg.args.get(key) ?? '');
  if (!values.includes(fallback)) return `${key}'s default "${fallback}" not published`;
  const prefixes = new Set(
    legs.map((leg) => {
      const value = leg.args.get(key) ?? '';
      return value && leg.name.endsWith(value) ? leg.name.slice(0, -value.length) : `${leg.name}?`;
    })
  );
  const [prefix] = prefixes;
  if (prefixes.size !== 1 || prefix === undefined) {
    return `image names that end in their ${key}, not ${legs.map((leg) => leg.name).join(', ')}`;
  }
  return image(`${prefix}\${${name}:-${fallback}}`);
}

/** Every service's image, or what is wrong with it, and the published names it covers. */
function check(compose: Mapping, workflow: Mapping) {
  const legs = published(workflow);
  const services = mappingOf(compose['services']);
  const wrong: string[] = [];
  const covered = new Set<string>();
  /** Each published service here, and the image it must name. */
  const images = new Map<string, string>();
  for (const [name, node] of Object.entries(services)) {
    const service = mappingOf(node);
    const image = textOf(service['image']);
    const dockerfile = dockerfileOf(service);
    const mine = legs.filter((leg) => leg.dockerfile === dockerfile);
    if (mine.length === 0) {
      if (image.includes('${REGISTRY')) wrong.push(`${name}: names the registry, never published`);
      continue;
    }
    const want = expected(service, mine);
    images.set(name, want);
    if (image !== want) wrong.push(`${name}: image "${image}", not "${want}"`);
    for (const leg of mine) covered.add(leg.name);
  }
  const missing = legs.map((leg) => leg.name).filter((name) => !covered.has(name));
  return { wrong, missing, legs, images };
}

/**
 * The override a server keeps (contracts/compose-override.md), from the
 * contract's one fenced YAML block, with its nodes, so compose's `!reset`
 * tags can be read: the `yaml` package leaves them unresolved, as strings.
 */
function overrideOf(markdown: string): Document {
  const blocks = [...markdown.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)];
  if (blocks.length !== 1) throw new Error(`${blocks.length} YAML blocks in the contract, not one`);
  const document = parseDocument(blocks[0]?.[1] ?? '');
  const unexpected = [...document.errors, ...document.warnings]
    .map((problem) => problem.message)
    .filter((message) => !/^Unresolved tag: !(reset|override) /.test(message));
  if (unexpected.length > 0) throw new Error(unexpected.join('\n'));
  return document;
}

/** `${VAR:-default}` (operator `-`) or `${VAR:?message}` (`?`) as `${VAR}`. */
const bare = (image: string, operator: '-' | '?') =>
  image.replace(new RegExp(`\\$\\{(\\w+):\\${operator}[^}]*\\}`, 'g'), '${$1}');

/**
 * What is wrong with a server's override: every published service, and `app`
 * in the development container's place running what no service here builds
 * (the site), must reset its `build:`, so the server never builds it, and name
 * the image the base file names with every variable required (`:?`), so a
 * setting left out stops compose instead of falling back to
 * `registry.invalid` or `main`. And none may pull by building, or not at all.
 */
function checkServer(compose: Mapping, workflow: Mapping, override: Document): string[] {
  const { images, missing } = check(compose, workflow);
  const wrong: string[] = [];
  const wanted = new Map(images);
  if (missing.length === 1 && missing[0] !== undefined) {
    wanted.set('app', `\${REGISTRY:-registry.invalid}/${missing[0]}:\${IMAGE_TAG:-main}`);
  } else {
    wrong.push(`app: runs one image no service builds, not ${missing.join(', ') || 'none'}`);
  }
  const base = mappingOf(compose['services']);
  for (const [name, want] of wanted) {
    if (!isMap(override.getIn(['services', name], true))) {
      wrong.push(`${name}: not in the override`);
      continue;
    }
    const image = textOf(override.getIn(['services', name, 'image']));
    if (image === '' || /\$\{(?!\w+:\?[^}]*\})/.test(image)) {
      wrong.push(`${name}: image "${image}" takes a variable without \`:?\``);
    } else if (bare(image, '?') !== bare(want, '-')) {
      wrong.push(`${name}: image "${image}", not "${want}" with \`:?\``);
    }
    const build = override.getIn(['services', name, 'build'], true);
    if (!isScalar(build) || build.tag !== '!reset' || String(build.value) !== 'null') {
      wrong.push(`${name}: build not \`!reset null\``);
    }
    const policy =
      override.getIn(['services', name, 'pull_policy']) ?? mappingOf(base[name])['pull_policy'];
    if (policy === 'build' || policy === 'never') wrong.push(`${name}: pull_policy ${policy}`);
  }
  return wrong;
}

/** The deployments CI tests nginx's configuration for: test-config.sh's loop. */
function deployments(script: string): string[] {
  return /^for env in ([\w ]+); do$/m.exec(script)?.[1]?.split(' ') ?? [];
}

const compose = read('docker-compose.yml');
const workflow = read('.github/workflows/publish-images.yml');
const override = overrideOf(
  readFileSync(join(ROOT, 'specs/032-release-server/contracts/compose-override.md'), 'utf8')
);
const nginxEnvs = deployments(readFileSync(join(ROOT, 'deploy/nginx/test-config.sh'), 'utf8'));

describe('the images compose names', () => {
  it('reads the workflow, the compose file and the override', () => {
    expect(published(workflow).length).toBeGreaterThan(0);
    expect(Object.keys(mappingOf(compose['services']))).toContain('content-node');
    expect(textOf(override.getIn(['services', 'app', 'image']))).toContain('/site:');
  });

  it('names, for every published Dockerfile, the image the workflow publishes, and the registry nowhere else', () => {
    const { wrong } = check(compose, workflow);
    expect(wrong).toEqual([]);
  });

  it('names the site only in the server’s override', () => {
    expect(check(compose, workflow).missing).toEqual(['site']);
  });

  it('builds java-library and pdf-export here, naming no image', () => {
    const services = mappingOf(compose['services']);
    for (const name of ['java-library', 'pdf-export']) {
      expect(mappingOf(services[name])['image'], name).toBeUndefined();
    }
  });

  it('publishes nginx for every deployment, and only those', () => {
    // local.conf is a developer's machine, never deployed.
    const confs = readdirSync(join(ROOT, 'deploy/nginx'))
      .filter((file) => file.endsWith('.conf') && file !== 'local.conf')
      .map((file) => file.slice(0, -'.conf'.length));
    expect(nginxEnvs).toEqual(expect.arrayContaining(['dev', 'release', 'production']));
    expect([...nginxEnvs].sort()).toEqual(confs.sort());
    const legs = published(workflow).filter((leg) => leg.dockerfile === 'deploy/nginx/Dockerfile');
    expect(legs.map((leg) => leg.args.get('NGINX_ENV')).sort()).toEqual([...nginxEnvs].sort());
  });
});

describe('a server’s override', () => {
  it('pulls every published image at required settings, and builds none', () => {
    expect(checkServer(compose, workflow, override)).toEqual([]);
  });
});

describe('the check itself', () => {
  const services = mappingOf(compose['services']);
  const withService = (name: string, change: (service: Mapping) => Mapping): Mapping => ({
    ...compose,
    services: { ...services, [name]: change(mappingOf(services[name])) },
  });
  const changed = (change: (document: Document) => void): Document => {
    const copy = override.clone();
    change(copy);
    return copy;
  };

  it('sees an image named differently from the workflow', () => {
    const renamed = withService('render', (service) => ({
      ...service,
      image: '${REGISTRY:-registry.invalid}/render-service:${IMAGE_TAG:-main}',
    }));
    expect(check(renamed, workflow).wrong).toEqual([
      'render: image "${REGISTRY:-registry.invalid}/render-service:${IMAGE_TAG:-main}", not "${REGISTRY:-registry.invalid}/render:${IMAGE_TAG:-main}"',
    ]);
  });

  it('sees nginx’s image not following its NGINX_ENV', () => {
    const fixed = withService('nginx', (service) => ({
      ...service,
      image: '${REGISTRY:-registry.invalid}/nginx-dev:${IMAGE_TAG:-main}',
    }));
    expect(check(fixed, workflow).wrong).toHaveLength(1);
  });

  it('sees a service that is never published naming the registry', () => {
    const named = withService('pdf-export', (service) => ({
      ...service,
      image: '${REGISTRY:-registry.invalid}/pdf-export:${IMAGE_TAG:-main}',
    }));
    expect(check(named, workflow).wrong).toEqual([
      'pdf-export: names the registry, never published',
    ]);
  });

  it('sees a published service naming no image', () => {
    const unnamed = withService('mcp', (service) =>
      Object.fromEntries(Object.entries(service).filter(([key]) => key !== 'image'))
    );
    expect(check(unnamed, workflow).wrong).toEqual([
      'mcp: image "", not "${REGISTRY:-registry.invalid}/mcp:${IMAGE_TAG:-main}"',
    ]);
  });

  it('sees a published service pulled by building, or never', () => {
    const built = withService('render', (service) => ({ ...service, pull_policy: 'build' }));
    expect(checkServer(built, workflow, override)).toEqual(['render: pull_policy build']);
    const never = changed((document) =>
      document.setIn(['services', 'app', 'pull_policy'], 'never')
    );
    expect(checkServer(compose, workflow, never)).toEqual(['app: pull_policy never']);
  });

  it('sees a published service the override leaves out, or leaves buildable', () => {
    const left = changed((document) => document.deleteIn(['services', 'content-node']));
    expect(checkServer(compose, workflow, left)).toEqual(['content-node: not in the override']);
    const built = changed((document) => document.deleteIn(['services', 'mcp', 'build']));
    expect(checkServer(compose, workflow, built)).toEqual(['mcp: build not `!reset null`']);
  });

  it('sees a setting the override lets fall back to a default, or leaves out', () => {
    const fallback = changed((document) =>
      document.setIn(
        ['services', 'nginx', 'image'],
        '${REGISTRY:?REGISTRY must be set}/nginx-${NGINX_ENV:-dev}:${IMAGE_TAG:?x}'
      )
    );
    expect(checkServer(compose, workflow, fallback)).toEqual([
      'nginx: image "${REGISTRY:?REGISTRY must be set}/nginx-${NGINX_ENV:-dev}:${IMAGE_TAG:?x}" takes a variable without `:?`',
    ]);
    const fixed = changed((document) =>
      document.setIn(['services', 'app', 'image'], '${REGISTRY:?r}/site:main')
    );
    expect(checkServer(compose, workflow, fixed)).toEqual([
      'app: image "${REGISTRY:?r}/site:main", not "${REGISTRY:-registry.invalid}/site:${IMAGE_TAG:-main}" with `:?`',
    ]);
  });

  it('reads the deployments from test-config.sh’s loop', () => {
    expect(deployments('x\nfor env in dev release production; do\n')).toEqual([
      'dev',
      'release',
      'production',
    ]);
    expect(deployments('for env in dev; do')).toEqual(['dev']);
  });
});

/**
 * The guide's check (its §1, and production's in §9) refuses a published
 * image whose tag is neither a full commit id (the release server's) nor a
 * release's write-once tag (`Release99`, production's). Its patterns, read
 * from the guide and run through grep itself, as the server runs them.
 */
function tagPatterns(guide: string): string[] {
  return [...guide.matchAll(/grep -E '\^ \+image:' \| grep -vE '([^']+)'/g)].map(
    ([, pattern = '']) => pattern
  );
}

/** Whether `pattern` (grep -vE) refuses an image at `tag`, as the guide's check runs it. */
function refuses(pattern: string, tag: string): boolean {
  const line = `    image: registry.invalid/content-node:${tag}\n`;
  const grep = spawnSync('grep', ['-vE', pattern], { input: line, encoding: 'utf8' });
  if (grep.status === 2 || grep.error) throw new Error(`grep -vE '${pattern}': ${grep.stderr}`);
  // grep -v exits 0 when it prints a line: the image is refused.
  return grep.status === 0;
}

describe('the guide’s check of the published images’ tags', () => {
  const patterns = tagPatterns(readFileSync(join(ROOT, 'deploy/release-server/README.md'), 'utf8'));
  const commit = '0123456789abcdef0123456789abcdef01234567';

  it('is in the guide twice, the release server’s and production’s, the same', () => {
    expect(patterns).toHaveLength(2);
    expect(new Set(patterns).size).toBe(1);
  });

  it.each([commit, 'Release99', 'Release100'])('lets %s through', (tag) => {
    for (const pattern of patterns) expect(refuses(pattern, tag)).toBe(false);
  });

  it.each([
    'main',
    'latest',
    'Release',
    'release99',
    'RELEASE99',
    'Release99a',
    'Release-99',
    commit.slice(0, 7),
    `${commit}0`,
    commit.toUpperCase(),
  ])('refuses %s', (tag) => {
    for (const pattern of patterns) expect(refuses(pattern, tag)).toBe(true);
  });
});
