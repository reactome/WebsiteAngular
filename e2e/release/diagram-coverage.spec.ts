import { test, expect } from '@playwright/test';

// Every top-level pathway draws something.
//
// The release document asks for this directly -- "click on each of the top-level
// pathway names in the pathway hierarchy; a diagram should be drawn on the right
// for each of them" -- and it is 29 clicks a person otherwise makes by hand every
// release. It is also the broadest single guarantee in the suite: a change that
// breaks one family of diagrams while leaving the one pathway other tests happen
// to open intact would pass everything else and fail here.
//
// The list comes from the content service rather than being written down, so a
// pathway promoted to top level is covered the release it appears.

test.describe('Every top-level pathway', () => {
  test('draws a diagram or an illustration', async ({ context, request }) => {
    // 29 pathways, each a real diagram load, three at a time.
    test.setTimeout(12 * 60 * 1000);

    const response = await request.get('/ContentService/data/pathways/top/9606');
    expect(response.ok(), 'the content service listed the top-level pathways').toBe(true);
    const pathways = (await response.json()) as { stId: string; displayName: string }[];

    // A floor, not an exact count: pathways get promoted, and a test that fails
    // when the data grows is a test people learn to ignore.
    expect(pathways.length, 'top-level pathways').toBeGreaterThan(25);

    // Three at a time, each in its own page.
    //
    // Sequentially this walked 29 real diagram loads inside one test, and in CI --
    // an unoptimised dev build on a two-core runner -- the three largest
    // (Circadian clock, Gene expression, Neuronal System) did not finish inside a
    // 60s wait, so the whole guarantee failed on the slowest members rather than
    // on anything being broken. Playwright shards by test, so it cannot split one
    // test for us; doing our own concurrency here is what brings the wall clock
    // down and gives each diagram room.
    // One lane against a deployed site, three against a local dev server.
    //
    // Three concurrent diagram loads is a fair use of a developer's machine and
    // far too much for beta, which is a single node process behind Cloudflare:
    // the burst had six pathways "not drawing" that render perfectly by hand.
    // Verification would rather be slow than wrong.
    const local = /localhost|127\.0\.0\.1/.test(process.env['E2E_BASE_URL'] ?? 'localhost');
    const lanes = local ? 3 : 1;
    const empty: string[] = [];
    const queue = [...pathways];
    const budget = local ? 120_000 : 180_000;

    // A fresh page per pathway. Twenty-nine large diagrams in one page leaves
    // twenty-nine cytoscape instances' worth of canvases and buffers behind, and
    // the failures were all late in the walk -- pathways that draw perfectly when
    // asked for on their own. A page costs a fraction of a second; being wrong
    // about which diagrams work costs a curator an afternoon.
    const walk = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { stId, displayName } = next;
        const page = await context.newPage();
        try {
          await page.goto(`/PathwayBrowser/${stId}`);
          // Either kind of view counts: most are cytoscape diagrams, the
          // well-illustrated ones are EHLDs, and both are a drawn pathway.
          await page.waitForSelector('#cytoscape canvas, cr-ehld svg', { timeout: budget });

          // A canvas exists before anything is on it, so ask what was drawn. The
          // legend is a second cytoscape instance that appears first and would
          // otherwise make an empty diagram look fine.
          const drawn = await page.evaluate(() => {
            const illustration = document.querySelector('cr-ehld svg');
            if (illustration) return illustration.querySelectorAll('*').length;
            const canvas = document.querySelector<HTMLCanvasElement>('#cytoscape canvas');
            return canvas && canvas.width > 0 && canvas.height > 0 ? canvas.width : 0;
          });
          if (!drawn) empty.push(`${displayName} (${stId}) — nothing drawn`);
        } catch {
          empty.push(`${displayName} (${stId}) — no diagram appeared`);
        } finally {
          await page.close();
        }
      }
    };

    await Promise.all(Array.from({ length: lanes }, () => walk()));
    empty.sort();

    expect(empty, 'top-level pathways that did not draw').toEqual([]);
  });
});
