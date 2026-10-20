import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Where nginx sends a ContentService request, against where the dev proxy
 * sends it.
 *
 * The two tables are kept by hand, so they can drift: a route added to one
 * and not the other answers from node under `ng serve` and from Java on
 * beta, or the other way round. So nginx's own order is run here -- exact
 * locations, then the regex locations in file order -- over every URL the
 * dev proxy's test names (projects/website-angular/src/scripts/
 * proxy-order.spec.ts), each also with a trailing slash, and must agree with
 * the dev proxy on every one.
 *
 * The slash because Spring matches `/x/` wherever it matches `/x`, on every
 * ContentService endpoint. While Java serves what nginx does not route to
 * node, a slashed URL that missed node's route still got Java's answer; once
 * Java is switched off it would get none.
 */
const root = process.cwd();
// In nginx's order: routes.conf includes routes-core.conf before any location
// of its own, so routes-core's regexes are tried first. routes.conf was once
// left out, and with it the rate-limited exporter location -- a route added
// to routes-core for an exporter path would have silently dropped that limit.
const core = readFileSync(join(__dirname, 'common/routes-core.conf'), 'utf8');
const deployed = readFileSync(join(__dirname, 'common/routes.conf'), 'utf8');
const conf = `${core}\n${deployed}`;

/**
 * What answers behind each upstream name. An upstream nobody has classified
 * fails the test below, so a new Java service cannot be added without saying
 * which side it is: node, Tomcat (the Java being retired), or a Java service
 * of spec 010.
 */
const UPSTREAMS: Record<string, string> = {
  content_node: 'node',
  content: 'tomcat',
  analysis: 'tomcat',
  site: 'site',
  render: 'render',
  mcp: 'other',
  chatbot: 'other',
  deltasignal: 'other',
};

type Location = { kind: string; path: string; target: string; body: string };
const locations: Location[] = [
  ...conf.matchAll(/^location\s+(=|~\*?|\^~)?\s*("[^"]*"|\S+)\s*\{([^}]*)\}/gm),
].map((m) => ({
  kind: m[1] ?? '',
  // A quoted path is nginx's way to write one holding ';' or '{'.
  path: m[2].replace(/^"(.*)"$/, '$1'),
  target: m[3].includes('content-node-proxy.conf')
    ? 'node'
    : (UPSTREAMS[m[3].match(/proxy_pass\s+https?:\/\/([\w-]+)/)?.[1] ?? ''] ??
      (/proxy_pass/.test(m[3]) ? 'unclassified' : 'none')),
  body: m[3],
}));

// routes-core.conf's `if ($request_uri ~ "…") { return 418; }`, which hands
// a matrix parameter to node to refuse whatever location would match.
const refusing = conf.match(/^if \(\$request_uri ~ "([^"]+)"\) \{ return 418; \}$/m)?.[1];

/**
 * The location nginx chooses: an exact match; else the first regex, in file
 * order; else the longest prefix. (No `^~` locations exist; a test below
 * says so.)
 */
function nginxLocation(url: string): Location | undefined {
  const path = url.split('?')[0];
  // The server-level refusal, before any location: on the path as sent.
  if (refusing && new RegExp(refusing).test(url))
    return locations.find((l) => l.path === '@content_node_refuses');
  const exact = locations.find((l) => l.kind === '=' && l.path === path);
  if (exact) return exact;
  const regex = locations.find(
    (l) => l.kind.startsWith('~') && new RegExp(l.path, l.kind === '~*' ? 'i' : '').test(path)
  );
  if (regex) return regex;
  return locations
    .filter((l) => l.kind === '' && path.startsWith(l.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

const nginxTarget = (url: string) => nginxLocation(url)?.target ?? 'none';
const nginxSendsToNode = (url: string) => nginxTarget(url) === 'node';

// The dev proxy, read as `ng serve` reads it (see proxy-order.spec.ts).
const load = createRequire(join(root, 'package.json'))(
  join(root, 'node_modules/@angular/build/src/utils/load-proxy-config.js')
) as {
  loadProxyConfiguration(root: string, file: string): Promise<Record<string, { target?: string }>>;
};
const contentNode = process.env['CONTENT_NODE_TARGET'] || 'http://127.0.0.1:4400';
async function proxySendsToNode(url: string): Promise<boolean> {
  const table = await load.loadProxyConfiguration(root, 'proxy.conf.js');
  const context = Object.keys(table).find(
    (key) => (key.startsWith('^') && new RegExp(key).test(url)) || url.startsWith(key)
  );
  return context !== undefined && table[context]?.target === contentNode;
}

const slashed = (url: string) => {
  const at = url.indexOf('?');
  const [path, query] = at === -1 ? [url, ''] : [url.slice(0, at), url.slice(at)];
  return path.endsWith('/') ? url : `${path}/${query}`;
};

const named = [
  ...readFileSync(join(root, 'projects/website-angular/src/scripts/proxy-order.spec.ts'), 'utf8')
    // Literal URLs only: a template's ${...} is filled in at run time there.
    .matchAll(/['`](\/ContentService\/[^'`$]*)['`]/g),
].map((m) => m[1]);
const urls = [...new Set(named.flatMap((url) => [url, slashed(url)]))];

describe('nginx and the dev proxy agree', () => {
  it('reading every location the file has', () => {
    // A block the parser cannot read (an indented one, a brace in a comment)
    // would otherwise count as Java without a word.
    expect(locations).toHaveLength(conf.match(/^\s*location\s/gm)?.length ?? 0);
    expect(locations.filter((l) => l.target === 'node')).toHaveLength(
      conf.match(/content-node-proxy\.conf/g)?.length ?? 0
    );
  });

  it('on a list long enough to mean something', () => {
    expect(urls.length).toBeGreaterThan(150);
  });

  for (const url of urls)
    it(`on ${url}`, async () => {
      expect([url, nginxSendsToNode(url)]).toEqual([url, await proxySendsToNode(url)]);
    });

  // And every node location is written to take one -- the URLs above do
  // not reach all of them (some of the proxy test's are built at run time).
  const exact = new Set(locations.filter((l) => l.kind === '=').map((l) => l.path));
  // Not the named location a refusal is handed to: it matches no path.
  for (const { kind, path } of locations.filter(
    (l) => l.target === 'node' && !l.path.startsWith('@')
  )) {
    if (kind === '=') {
      if (!path.endsWith('/'))
        it(`has ${path} with its slashed twin`, () => {
          expect(exact.has(`${path}/`)).toBe(true);
        });
    } else
      it(`takes a trailing slash at ${path}`, () => {
        expect(kind.startsWith('~') && path.endsWith('/?$')).toBe(true);
      });
  }

  // Every node route takes the slash: the slashed form of a URL nginx sends
  // to node goes to node too.
  for (const url of named.filter(nginxSendsToNode))
    it(`takes ${url} with a trailing slash`, () => {
      expect([slashed(url), nginxSendsToNode(slashed(url))]).toEqual([slashed(url), true]);
    });
});

/**
 * Every endpoint node answers, as written in tools/content-node/service.ts,
 * filled with sample ids. A node route answered by Java -- Tomcat or a Java
 * service -- is the one thing the routing must never do.
 */
const NOT_YET_ROUTED: Record<string, string> = {
  // Implemented, held back until the exporter log scan (#273).
  '/ContentService/exporter/diagram/{id}': 'spec 006 T090',
  // The species overview at the old fireworks exporter's URL, held back with it.
  '/ContentService/exporter/fireworks/{id}': 'spec 006 T093',
};
// node's own list, as the service builds it -- some paths are template
// literals, which a reading of the source text missed (four person lists,
// the species lists, in-depth, suggest and spellcheck).
const { endpoints } = (await import('../../tools/content-node/service.ts')) as {
  endpoints: { path: string; sample?: string }[];
};
const nodeEndpoints = endpoints.map((e) => e.path);
/** An endpoint as a URL: its own sample id where it has one. */
const sample = (path: string) => {
  // A sample may carry a query; it goes on the end, not into the path.
  const [id, query] = (endpoints.find((e) => e.path === path)?.sample ?? '').split('?');
  const filled = id ? path.replace(/\{[^}]+\}/, id) : path;
  return `${filled
    .replace(/\/schema\/\{id\}/, '/schema/Pathway')
    .replace(/\{(id|diagram|pathwayId)\}/g, 'R-HSA-109581')
    .replace(/\{[^}]+\}/g, 'X1')}${query ? `?${query}` : ''}`;
};

describe('where nginx sends things', () => {
  it('knows what is behind every upstream it names', () => {
    expect(locations.filter((l) => l.target === 'unclassified').map((l) => l.path)).toEqual([]);
  });

  it('has no ^~ location, which its order above leaves out', () => {
    expect(locations.filter((l) => l.kind === '^~').map((l) => l.path)).toEqual([]);
  });

  it('reads the endpoints node answers', () => {
    expect(nodeEndpoints.length).toBeGreaterThan(55);
  });

  for (const path of nodeEndpoints.filter((p) => !(p in NOT_YET_ROUTED)))
    it(`sends what node answers to node: ${path}`, () => {
      expect([sample(path), nginxTarget(sample(path))]).toEqual([sample(path), 'node']);
    });

  for (const [path, why] of Object.entries(NOT_YET_ROUTED))
    it(`still lists ${path} as unrouted (${why}) only while it is`, () => {
      expect(nodeEndpoints).toContain(path);
      expect(nginxTarget(sample(path))).not.toBe('node');
    });

  // The exporters share the render budget whichever side draws them
  // (routes.conf); a location that won the match without it would drop it.
  for (const kind of ['diagram', 'fireworks', 'document/event', 'event'])
    for (const ext of ['png', 'svg', 'pdf'])
      it(`keeps the render budget on /ContentService/exporter/${kind}/….${ext}`, () => {
        const url = `/ContentService/exporter/${kind}/R-HSA-109581.${ext}`;
        const location = nginxLocation(url);
        expect([url, /limit_req\s+zone=render_rate/.test(location?.body ?? '')]).toEqual([
          url,
          true,
        ]);
      });
});

/**
 * Java's own neighbours of node routes, which a route matching too much
 * would take: the agreement test above compares the two tables only with
 * each other.
 */
const JAVAS = [
  '/ContentService/data/species/9606',
  '/ContentService/data/species/mainx',
  '/ContentService/data/content/tocx',
  '/ContentService/data/content/toc/X1',
  '/ContentService/data/diseases/X1',
  '/ContentService/data/schema/model/X1',
  '/ContentService/data/query/abridged/R-HSA-109581',
  '/ContentService/data/query/R-HSA-109581/more',
  '/ContentService/interactors/psicquic/resourcesx',
  '/ContentService/search/facet_queryx',
];

describe("Java's neighbours of node routes", () => {
  for (const url of JAVAS)
    it(`leaves ${url} to Java`, async () => {
      for (const variant of [url, slashed(url)])
        expect([variant, nginxTarget(variant), await proxySendsToNode(variant)]).toEqual([
          variant,
          'tomcat',
          false,
        ]);
    });
});

/**
 * A matrix parameter -- a raw ';' in the path -- is node's to refuse with
 * Spring's 404, on any segment and whichever endpoint it would be (spec 006
 * T008): a literal location does not match one, so without the refusal it
 * reached Java, which answers it. An encoded ';' and a ';' in the query
 * string are not one.
 */
describe('a matrix parameter', () => {
  const variants = (url: string) => {
    const at = url.indexOf('?');
    const [path, query] = at === -1 ? [url, ''] : [url.slice(0, at), url.slice(at)];
    const segments = path.split('/');
    return segments
      .slice(2)
      .flatMap((segment, i) =>
        segment
          ? [segments.map((s, j) => (j === i + 2 ? `${s};jsessionid=x` : s)).join('/') + query]
          : []
      );
  };
  for (const url of [...urls, ...JAVAS])
    it(`on any segment of ${url} goes to node to be refused`, async () => {
      for (const variant of variants(url))
        expect([variant, nginxTarget(variant), await proxySendsToNode(variant)]).toEqual([
          variant,
          'node',
          true,
        ]);
    });

  it('is not an encoded one, nor one in the query string', async () => {
    for (const url of [
      '/ContentService/data/query/abridged/R-HSA-109581%3Bx',
      '/ContentService/data/species/9606?a=1;b=2',
    ])
      expect([url, nginxTarget(url), await proxySendsToNode(url)]).toEqual([url, 'tomcat', false]);
  });
});

/**
 * Each upstream at an address of its own. The analysis gateway was first
 * given 127.0.0.1:4320, the MCP server's: deployed, every analysis on beta
 * would have gone to MCP, and the gateway would have failed to start.
 */
describe('the upstreams of each deployment', () => {
  for (const file of ['dev.conf', 'release.conf', 'production.conf', 'local.conf'])
    it(`each has its own address in ${file}`, () => {
      const text = readFileSync(join(__dirname, file), 'utf8');
      const addresses = [...text.matchAll(/^upstream\s+([\w-]+)\s*\{([^}]*)\}/gm)].flatMap(
        ([, name, body]) =>
          [...body.matchAll(/^\s*server\s+([^\s;]+)/gm)].map((m) => [m[1], name] as const)
      );
      const byAddress = new Map<string, string[]>();
      for (const [address, name] of addresses)
        byAddress.set(address, [...(byAddress.get(address) ?? []), name]);
      // Tomcat hosts both Java webapps, so `content`, `analysis` where it goes
      // to Tomcat directly, and `analysis_direct` share its address; nothing
      // else may share one.
      const TOMCAT = new Set(['content', 'analysis', 'analysis_direct']);
      const shared = [...byAddress].filter(
        ([, names]) => names.length > 1 && !names.every((name) => TOMCAT.has(name))
      );
      expect(shared).toEqual([]);
    });
});
