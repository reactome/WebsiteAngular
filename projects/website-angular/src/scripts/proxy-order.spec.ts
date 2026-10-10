import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

// Which backend `ng serve` sends a request to. The dev server does not use
// proxy.conf.js as written: Angular's loader rewrites every glob key into a
// regex and re-inserts it at the end of the table, and Vite then takes the
// first key that matches. A specific entry written above a general one can
// still lose to it (#318). So the table is read through Angular's own loader,
// and matched by Vite's rule, rather than read off the file.

type Entry = { target?: string };

const root = process.cwd();
// By file: the package does not export its loader, and this is the code that
// decides what `ng serve` does.
const load = createRequire(path.join(root, 'package.json'))(
  path.join(root, 'node_modules/@angular/build/src/utils/load-proxy-config.js')
) as {
  loadProxyConfiguration(root: string, file: string): Promise<Record<string, Entry>>;
};

/** Vite's doesProxyContextMatchUrl: a `^` key is a regex, anything else a prefix. */
const matches = (context: string, url: string) =>
  (context.startsWith('^') && new RegExp(context).test(url)) || url.startsWith(context);

async function targetOf(url: string) {
  const table = await load.loadProxyConfiguration(root, 'proxy.conf.js');
  const context = Object.keys(table).find((key) => matches(key, url));
  return context && table[context]?.target;
}

const contentNode = process.env['CONTENT_NODE_TARGET'] || 'http://127.0.0.1:4400';
const backend = process.env['REACTOME_BACKEND'] || 'http://localhost:8080';

describe('the dev server proxy', () => {
  for (const list of [
    'authoredPathways',
    'authoredReactions',
    'reviewedPathways',
    'reviewedReactions',
  ]) {
    it(`sends a person's ${list} to the content service`, async () => {
      expect(await targetOf(`/ContentService/data/person/0000-0002-1825-0097/${list}`)).toBe(
        contentNode
      );
      expect(await targetOf(`/ContentService/data/person/68285/${list}?page=1`)).toBe(contentNode);
    });
  }

  for (const other of [
    '/ContentService/data/person/68285',
    '/ContentService/data/person/68285/publications',
    '/ContentService/data/person/68285/authoredPathwaysAndMore',
    '/ContentService/data/database/version',
  ]) {
    it(`leaves ${other} with Java`, async () => {
      expect(await targetOf(other)).toBe(backend);
    });
  }
});
