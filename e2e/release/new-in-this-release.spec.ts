import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Everything the release announcement says is new actually opens.
 *
 * The release document asks a person to check that "a newly added pathway,
 * reaction and complex render" -- which a test cannot hardcode, because what is
 * new changes every release. It does not need to: the announcement we publish
 * names them, and that list is in the repo.
 *
 * It writes them as bare dbIds -- `/PathwayBrowser/#1280218` -- which is how the
 * old browser addressed a pathway. Until #182 none of those links worked at all:
 * 278 of them across the news, 24 in the current release's announcement, every
 * one opening the browser with no pathway in it. So this checks both halves at
 * once, the links and the pathways they point at.
 */

const NEWS = 'projects/website-angular/content/about/news';

/** The newest release announcement in the repo, and the pathways it links. */
function announced(): { file: string; ids: string[] } {
  const files = readdirSync(NEWS).filter(
    (name) => /released|news/i.test(name) && name.endsWith('.mdx')
  );
  // Named with a leading sequence number, so the highest is the newest.
  const newest = files
    .map((name) => ({ name, order: Number(/^(\d+)/.exec(name)?.[1] ?? 0) }))
    .sort((a, b) => b.order - a.order)[0];
  if (!newest) return { file: '', ids: [] };

  const body = readFileSync(`${NEWS}/${newest.name}`, 'utf8');
  const ids = [
    ...new Set(
      [...body.matchAll(/PathwayBrowser\/#(\d{4,}|R-[A-Z]{3}-\d+)/g)].map((match) => match[1])
    ),
  ];
  return { file: newest.name, ids };
}

test.describe('What the release announcement says is new', () => {
  test('every pathway it links to opens', async ({ context }) => {
    const { file, ids } = announced();
    test.skip(!ids.length, `no pathway links found in ${file || 'any announcement'}`);

    // Each one is a real diagram or illustration load.
    test.setTimeout(12 * 60 * 1000);
    console.log(`Checking ${ids.length} pathways linked from ${file}`);

    const failures: string[] = [];

    // Three at a time, as the top-level coverage test does: sequentially this is
    // twenty-odd diagram loads and the suite has a budget.
    for (let start = 0; start < ids.length; start += 3) {
      await Promise.all(
        ids.slice(start, start + 3).map(async (id) => {
          const page = await context.newPage();
          try {
            // Exactly as the announcement writes it, fragment and all.
            await page.goto(`/PathwayBrowser/#${id}`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(
              () => {
                const container = document.querySelector('#cytoscape') as
                  (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
                const drawn = container?._cyreg?.cy?.elements().length ?? 0;
                return drawn > 0 || Boolean(document.querySelector('cr-ehld svg'));
              },
              { timeout: 90_000 }
            );
            // And it left the reader on a stable id. A dbId is not stable
            // across releases, so a URL carrying one is a URL not worth
            // keeping -- an old link should hand over a good one.
            const landed = new URL(page.url()).pathname;
            if (!/R-[A-Z]{3}-\d+/.test(landed)) {
              failures.push(`${id} opened but left a dbId in the URL: ${landed}`);
            }
          } catch {
            const landed = page.url();
            failures.push(`${id} (landed on ${landed})`);
          } finally {
            await page.close();
          }
        })
      );
    }

    expect(failures, `announced pathways that did not open, from ${file}`).toEqual([]);
  });
});
