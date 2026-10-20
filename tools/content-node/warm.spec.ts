// @vitest-environment node
//
// warm.mjs fills the edge cache after a release's purge. A list spelled
// unlike the site's requests would warm entries no reader asks for; a run
// against a node still holding the last release would keep that release's
// answers at the edge until the next purge; and a warm-up that did not say
// which answers were not cacheable would report success over nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from './classify.mjs';
import { ANCESTORS, ENHANCED, FIXED, main, warm, warmList } from './warm.ts';

const answers = {
  '/ContentService/data/database/version': 98,
  '/ContentService/data/species/main': [{ taxId: '10090' }, { taxId: '9606' }],
  '/ContentService/data/pathways/top/9606': [{ stId: 'R-HSA-1640170' }, { stId: 'R-HSA-162582' }],
};
const getJson = async (path: string) => (answers as Record<string, unknown>)[path];

/** A stand-in for fetch: the answers above, every other URL a cacheable 200. */
/** How a path fails: redirects, throws, answers unlabelled, or is missing. */
type Failure = 'redirect' | 'throw' | 'unlabelled' | 'missing' | undefined;

function site({ bad = (_path: string): Failure => undefined } = {}) {
  const asked: string[] = [];
  const fetch = async (url: string, options: { redirect?: RequestRedirect } = {}) => {
    asked.push(url);
    const path = new URL(url).pathname + new URL(url).search;
    // As fetch does: a redirect is followed, and its target answered,
    // unless the caller asked to see it.
    const failure =
      bad(path) === 'redirect' && options.redirect !== 'manual' ? undefined : bad(path);
    if (failure === 'throw') throw Object.assign(new Error('reset'), { name: 'TypeError' });
    const headers = new Map(failure === 'unlabelled' ? [] : [['x-cache-rule', 'standard']]);
    const body = JSON.stringify((answers as Record<string, unknown>)[path] ?? {});
    return {
      status: failure === 'redirect' ? 301 : failure === 'missing' ? 404 : 200,
      headers: { get: (name: string) => headers.get(name) ?? null },
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => body,
    };
  };
  return { asked, fetch };
}

describe('warmList', () => {
  it("is the fixed lists, the release's species and human top-level pathways, each URL once", async () => {
    const list = await warmList(getJson);
    for (const path of FIXED) expect(list).toContain(`/ContentService${path}`);
    expect(list).toContain('/ContentService/data/content/toc');
    expect(list).toContain('/ContentService/data/pathways/top/10090');
    expect(list.filter((path) => path.includes('enhanced/v2/R-HSA-1640170'))).toHaveLength(2);
    expect(list).toContain(
      '/ContentService/data/event/R-HSA-162582/ancestors?includeRef=true&view=nested-aggregated'
    );
    expect(new Set(list).size).toBe(list.length);
    expect(list).toHaveLength(FIXED.length + 2 + 2 * 3);
  });

  it('asks only for URLs in standard form, which the edge keeps', async () => {
    for (const path of await warmList(getJson))
      expect([path, classify('GET', path)?.ok]).toEqual([path, true]);
  });

  it('spells each query as the site itself sent it, in the recorded e2e traffic', () => {
    const recorded = new Set();
    const dir = new URL('../../e2e/har/', import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.har')))
      for (const match of readFileSync(new URL(file, dir), 'utf8').matchAll(
        /\/ContentService\/data\/(?:query\/enhanced\/v2|event\/[^/"?]+\/ancestors)[^"?]*\?([^"]*)"/g
      ))
        recorded.add(match[1]);
    for (const query of [...ENHANCED, ANCESTORS])
      expect([query, recorded.has(query)]).toEqual([query, true]);
  });
});

describe('warm', () => {
  it('asks for each once, and names each answer that is not a cacheable 200, a redirect included', async () => {
    const { asked, fetch } = site({
      bad: (path) =>
        (({ '/b': 'unlabelled', '/c': 'missing', '/d': 'redirect' }) as Record<string, Failure>)[
          path
        ],
    });
    const { missed } = await warm('https://site', ['/a', '/b', '/c', '/d'], { fetch, pause: 0 });
    expect(asked).toEqual(['https://site/a', 'https://site/b', 'https://site/c', 'https://site/d']);
    expect(missed).toEqual(['200 - /b', '404 standard /c', '301 standard /d']);
  });

  it('records a request that fails and goes on to the next', async () => {
    const { asked, fetch } = site({ bad: (path) => (path === '/a' ? 'throw' : undefined) });
    const { missed } = await warm('https://site', ['/a', '/b'], { fetch, pause: 0 });
    expect(asked).toHaveLength(2);
    expect(missed).toEqual(['failed (TypeError) /a']);
  });
});

describe('main', () => {
  const run = async (argv: string[], options: Parameters<typeof main>[1] = {}) => {
    const lines: string[] = [];
    const code = await main(argv, { pause: 0, log: (line) => lines.push(line), ...options });
    return [code, lines.join('\n')];
  };

  it('warms when the content API reports the release asked for, and says so', async () => {
    const [code, output] = await run(['https://site', '98'], site());
    expect(code).toBe(0);
    expect(output).toContain('all cacheable');
  });

  it("refuses to warm a node still holding another release's answers", async () => {
    const { asked, fetch } = site();
    const [code, output] = await run(['https://site', '99'], { fetch });
    expect(code).toBe(2);
    expect(output).toContain('reports release 98, not 99');
    expect(asked).toEqual(['https://site/ContentService/data/database/version']);
  });

  it('fails, naming them, when any answer is not cacheable', async () => {
    const [code, output] = await run(
      ['https://site', '98'],
      site({ bad: (path) => (path.endsWith('/toc') ? 'unlabelled' : undefined) })
    );
    expect(code).toBe(1);
    expect(output).toContain('200 - /ContentService/data/content/toc');
  });

  it('refuses without a site and a release', async () => {
    expect((await run(['site', '98']))[0]).toBe(2);
    expect((await run(['https://site']))[0]).toBe(2);
  });
});
