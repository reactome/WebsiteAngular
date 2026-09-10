import { test, expect, type Page } from '@playwright/test';

/**
 * Back leaves the pathway browser, and undoes what the reader actually did.
 *
 * Opening a pathway used to cost three presses of Back to get out of, and the
 * first two did something nobody asked for: the app writes its own defaults into
 * the URL, so `?tab=info` and then `?tab=details` each became a history entry,
 * and going back stepped through tab changes the reader never made before it
 * would leave the page.
 *
 * The URL still has to carry the tab -- a shared link has to open on the same
 * thing -- so the fix is not to stop writing it. It is that being *given* a tab
 * replaces the entry while *choosing* one adds to it. Both halves are here,
 * because keeping the second is what stops the first turning into "Back does
 * nothing in this app".
 */

const NEWS = '/about/news';
const PATHWAY = 'R-HSA-109606';
const BOOT_TIMEOUT = 90_000;

async function openPathway(page: Page) {
  await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const container = document.querySelector('#cytoscape') as
        (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
      return (container?._cyreg?.cy?.elements().length ?? 0) > 0;
    },
    { timeout: BOOT_TIMEOUT }
  );
  // The tab settles a moment after the diagram.
  await page.waitForTimeout(2500);
}

test.describe('The back button', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('leaves the pathway browser without stepping through tabs first', async ({ page }) => {
    await page.goto(NEWS);
    await page.waitForTimeout(1500);

    await openPathway(page);
    // The tab is still in the URL: a shared link must open on the same thing.
    expect(new URL(page.url()).search).toContain('tab=');

    let steps = 0;
    let where = '';
    while (steps < 4) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForTimeout(2500);
      steps++;
      where = new URL(page.url()).pathname;
      if (where === NEWS) break;
    }

    expect(where, `still in the pathway browser after ${steps} presses`).toBe(NEWS);
    // It was three, two of them spent changing tabs nobody chose.
    expect(steps, 'presses of Back needed to leave').toBeLessThanOrEqual(2);
  });

  test('still undoes a tab the reader chose', async ({ page }) => {
    await openPathway(page);
    const settled = new URL(page.url()).search;

    const molecule = page
      .locator('[role="tab"]')
      .filter({ hasText: /Molecule/i })
      .first();
    test.skip((await molecule.count()) === 0, 'this pathway offers no Molecule tab');
    await molecule.click();
    await page.waitForTimeout(2500);

    const chosen = new URL(page.url()).search;
    expect(chosen, 'choosing a tab changes the URL').not.toBe(settled);

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    expect(new URL(page.url()).search, 'a choice the reader made is undoable').toBe(settled);
  });
});
