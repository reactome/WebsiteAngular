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
const conf = readFileSync(join(__dirname, 'common/routes-core.conf'), 'utf8');

type Location = { kind: string; path: string; node: boolean };
const locations: Location[] = [
  ...conf.matchAll(/^location\s+(=|~\*?|\^~)?\s*("[^"]*"|\S+)\s*\{([^}]*)\}/gm),
].map((m) => ({
  kind: m[1] ?? '',
  // A quoted path is nginx's way to write one holding ';' or '{'.
  path: m[2].replace(/^"(.*)"$/, '$1'),
  node: m[3].includes('content-node-proxy.conf'),
}));

/** nginx: an exact location, else the first regex in file order, else the prefix (Java). */
function nginxSendsToNode(url: string): boolean {
  const path = url.split('?')[0];
  const exact = locations.find((l) => l.kind === '=' && l.path === path);
  if (exact) return exact.node;
  const regex = locations.find(
    (l) => l.kind.startsWith('~') && new RegExp(l.path, l.kind === '~*' ? 'i' : '').test(path)
  );
  return regex?.node ?? false;
}

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
    expect(locations.filter((l) => l.node)).toHaveLength(
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
  for (const { kind, path } of locations.filter((l) => l.node)) {
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
