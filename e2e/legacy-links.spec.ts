import { test, expect, type Page } from '@playwright/test';

/**
 * A link out of the news archive takes you somewhere, and lets you come back.
 *
 * The news used to carry 285 pathway links written the way the old browser
 * addressed one -- a bare dbId in the fragment, `/PathwayBrowser/#1280218`, 278
 * of them without the slash and 7 with -- alongside 708 already spelled
 * `#R-HSA-…`. Both are rewritten into proper routes now (#172, #182), and the
 * content's own links have since been rewritten to stable ids.
 *
 * Those counts are what the repo actually held before the rewrite, measured per
 * spelling. An earlier version of this comment said 278 and 86, which was the
 * count of one dbId spelling against a figure for the stId spellings that does
 * not reproduce at any scope -- content, repo-wide, or unique links.
 *
 * The dbId case stays tested anyway. Those links are a decade of citations,
 * bookmarks and other people's pages, and none of that can be edited; a dbId is
 * also not stable across releases, which is why our own content no longer uses
 * one.
 *
 * Rewriting a URL under the reader is easy to get wrong in a way nothing else
 * catches. Twice it left a history entry that still carried the fragment, and
 * going back to such an entry rewrites it forward again -- so someone who
 * followed a link out of the news archive could not get back to the news
 * archive at all. That is what this holds down.
 *
 * The count of Backs is deliberately loose: the browser already adds a couple of
 * entries of its own while a pathway settles, which a direct load does too. What
 * matters is that the reader can leave.
 */

const NEWS = '/about/news';
const BOOT_TIMEOUT = 90_000;

async function loadPathway(page: Page, target: string) {
  await page.goto(`/PathwayBrowser/${target}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const container = document.querySelector('#cytoscape') as
        (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
      const drawn = container?._cyreg?.cy?.elements().length ?? 0;
      return drawn > 0 || Boolean(document.querySelector('cr-ehld svg'));
    },
    { timeout: BOOT_TIMEOUT }
  );
}

/** Press Back until we are out of the pathway browser, or give up. */
async function backOutOf(page: Page, limit = 6) {
  for (let step = 1; step <= limit; step++) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForTimeout(2500);
    if (new URL(page.url()).pathname === NEWS) return step;
  }
  return null;
}

test.describe('Legacy pathway links', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  // Both spellings that reach us from outside, and a direct load to compare
  // against -- if the direct load needs as many Backs, the entries are the
  // browser's own doing rather than the rewrite's.
  for (const [target, label] of [
    ['#1280218', 'a dbId fragment, as links in the wild still write it'],
    ['#R-HSA-202733', 'a stable id fragment'],
    ['R-HSA-1280218', 'a direct stable id, for comparison'],
  ]) {
    test(`${label}: opens, and you can go back`, async ({ page }) => {
      await page.goto(NEWS);
      await page.waitForTimeout(1500);

      await loadPathway(page, target);

      // Whatever it was written as, the reader ends up on a stable id: a dbId
      // is not stable across releases, so it is not a URL to leave them with.
      expect(new URL(page.url()).pathname).toMatch(/\/PathwayBrowser\/R-[A-Z]{3}-\d+/);

      const steps = await backOutOf(page);
      expect(steps, 'the reader could not get back to the news archive').not.toBeNull();
    });
  }
});

/**
 * Legacy fragments that carry settings rather than a pathway.
 *
 * `#TOOL=AT` opened the analysis tool in the old browser and is the "Analysis
 * Tools" link in every release announcement we have published, the current one
 * included -- 45 of them. `#DIAGRAM=<dbId>` names the pathway to open, and there
 * are two in the v64 announcement. Neither matched the fragment pattern, so all
 * of them landed on an empty pathway browser.
 */
test.describe('Legacy fragments that are only settings', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('#TOOL=AT opens the analysis tool', async ({ page }) => {
    await page.goto('/PathwayBrowser/#TOOL=AT', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);

    // The tool is a panel, so the assertion is that it is open -- not merely
    // rendered, which it always is.
    await expect(page.locator('.dropdown.open cr-analysis-form')).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('analysisTab')).toBe('qualitative');
  });

  test('#DIAGRAM=<dbId> opens that pathway, on its stable id', async ({ page }) => {
    await page.goto('/PathwayBrowser/#DIAGRAM=9006934&PATH=162582', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(12000);

    const landed = new URL(page.url());
    // A dbId is not stable across releases, so the reader must not be left on one.
    expect(landed.pathname, 'it should have opened a pathway').toMatch(/R-[A-Z]{3}-\d+/);
    expect(landed.pathname, 'and not left the reader on a dbId').not.toMatch(/\/9006934/);
  });
});
