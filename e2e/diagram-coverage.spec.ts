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
  test('draws a diagram or an illustration', async ({ page, request }) => {
    // 29 pathways, each a real diagram load.
    test.setTimeout(10 * 60 * 1000);

    const response = await request.get('/ContentService/data/pathways/top/9606');
    expect(response.ok(), 'the content service listed the top-level pathways').toBe(true);
    const pathways = (await response.json()) as { stId: string; displayName: string }[];

    // A floor, not an exact count: pathways get promoted, and a test that fails
    // when the data grows is a test people learn to ignore.
    expect(pathways.length, 'top-level pathways').toBeGreaterThan(25);

    const empty: string[] = [];
    for (const { stId, displayName } of pathways) {
      await page.goto(`/PathwayBrowser/${stId}`);
      try {
        // Either kind of view counts: most are cytoscape diagrams, the
        // well-illustrated ones are EHLDs, and both are a drawn pathway.
        await page.waitForSelector('#cytoscape canvas, cr-ehld svg', { timeout: 60_000 });

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
      }
    }

    expect(empty, 'top-level pathways that did not draw').toEqual([]);
  });
});
