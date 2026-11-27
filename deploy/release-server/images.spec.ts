// @vitest-environment node
//
// The images a server pulls are the ones CI publishes (specs/032 R1, T011):
// every compose service built from a Dockerfile publish-images.yml publishes
// names that image, `${REGISTRY:-local}/<name>:${IMAGE_TAG:-main}`, so
// `docker compose pull` fetches it on a server and `docker compose build`
// builds it on beta. A name that drifts from the workflow's pulls nothing, or
// another image; a service the workflow never publishes (java-library,
// pdf-export) must not name the registry at all.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

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
  const image = (name: string) => `\${REGISTRY:-local}/${name}:\${IMAGE_TAG:-main}`;
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
function check(compose: Mapping, workflow: Mapping, override: string) {
  const legs = published(workflow);
  const services = mappingOf(compose['services']);
  const wrong: string[] = [];
  const covered = new Set<string>();
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
    if (image !== want) wrong.push(`${name}: image "${image}", not "${want}"`);
    for (const leg of mine) covered.add(leg.name);
  }
  // The site's image runs in the development container's place, through a
  // server's override (contracts/compose-override.md), not as a service here.
  for (const leg of legs) {
    if (override.includes(`image: \${REGISTRY}/${leg.name}:\${IMAGE_TAG}`)) covered.add(leg.name);
  }
  const missing = legs.map((leg) => leg.name).filter((name) => !covered.has(name));
  return { wrong, missing, legs };
}

const compose = read('docker-compose.yml');
const workflow = read('.github/workflows/publish-images.yml');
const override = readFileSync(
  join(ROOT, 'specs/032-release-server/contracts/compose-override.md'),
  'utf8'
);

describe('the images compose names', () => {
  it('reads the workflow and the compose file', () => {
    expect(published(workflow).length).toBeGreaterThan(0);
    expect(Object.keys(mappingOf(compose['services']))).toContain('content-node');
  });

  it('names, for every published Dockerfile, the image the workflow publishes, and the registry nowhere else', () => {
    const { wrong, missing } = check(compose, workflow, override);
    expect(wrong).toEqual([]);
    expect(missing, 'published, but pulled by nothing').toEqual([]);
  });

  it('names the site only in the server’s override', () => {
    expect(check(compose, workflow, '').missing).toEqual(['site']);
  });

  it('builds java-library and pdf-export here, naming no image', () => {
    const services = mappingOf(compose['services']);
    for (const name of ['java-library', 'pdf-export']) {
      expect(mappingOf(services[name])['image'], name).toBeUndefined();
    }
  });
});

describe('the check itself', () => {
  const services = mappingOf(compose['services']);
  const withService = (name: string, change: (service: Mapping) => Mapping): Mapping => ({
    ...compose,
    services: { ...services, [name]: change(mappingOf(services[name])) },
  });

  it('sees an image named differently from the workflow', () => {
    const renamed = withService('render', (service) => ({
      ...service,
      image: '${REGISTRY:-local}/render-service:${IMAGE_TAG:-main}',
    }));
    expect(check(renamed, workflow, override).wrong).toEqual([
      'render: image "${REGISTRY:-local}/render-service:${IMAGE_TAG:-main}", not "${REGISTRY:-local}/render:${IMAGE_TAG:-main}"',
    ]);
  });

  it('sees nginx’s image not following its NGINX_ENV', () => {
    const fixed = withService('nginx', (service) => ({
      ...service,
      image: '${REGISTRY:-local}/nginx-dev:${IMAGE_TAG:-main}',
    }));
    expect(check(fixed, workflow, override).wrong).toHaveLength(1);
  });

  it('sees a service that is never published naming the registry', () => {
    const named = withService('pdf-export', (service) => ({
      ...service,
      image: '${REGISTRY:-local}/pdf-export:${IMAGE_TAG:-main}',
    }));
    expect(check(named, workflow, override).wrong).toEqual([
      'pdf-export: names the registry, never published',
    ]);
  });

  it('sees a published service naming no image', () => {
    const unnamed = withService('mcp', (service) =>
      Object.fromEntries(Object.entries(service).filter(([key]) => key !== 'image'))
    );
    expect(check(unnamed, workflow, override).wrong).toEqual([
      'mcp: image "", not "${REGISTRY:-local}/mcp:${IMAGE_TAG:-main}"',
    ]);
  });
});
