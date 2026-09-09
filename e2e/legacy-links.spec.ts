import { test, expect, type Page } from '@playwright/test';

/**
 * A link out of the news archive takes you somewhere, and lets you come back.
 *
 * The news carries 278 pathway links written the way the old browser addressed
 * one: a bare dbId in the fragment, `/PathwayBrowser/#1280218`, plus 86 more as
 * `#R-HSA-…`. Both are rewritten into proper routes now (#172, #182).
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

  // Both spellings that appear in the content, and a direct load to compare
  // against -- if the direct load needs as many Backs, the entries are the
  // browser's own doing rather than the rewrite's.
  for (const [target, label] of [
    ['#1280218', 'a dbId fragment, as the release announcements write it'],
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
