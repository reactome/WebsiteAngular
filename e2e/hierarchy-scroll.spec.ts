import { test, expect, type Page } from '@playwright/test';

/**
 * The event hierarchy holds its place when you click something in it.
 *
 * Curators, re-testing #137: "no jumping in the search and the analysis table
 * and none in the upper section of event hierarchy, but pathways near the bottom
 * of the hierarchy (e.g. subevents) still jump."
 *
 * They were right, and the cause was not the revealing. Rebuilding the tree
 * starts by emptying it -- a workaround for an Angular Material bug where nested
 * children otherwise do not render -- and emptying it destroys every row, so the
 * container collapses and the browser resets the scroll to the top. Measured on
 * a deep sub-event: 274px, then 0, then 6. Expansion state was already carried
 * across that rebuild; the scroll position was not.
 *
 * Both halves matter, so both are checked: clicking a row you can already see
 * must not move the tree, and selecting one you cannot see must still bring it
 * into view.
 */

const BOOT_TIMEOUT = 90_000;
// Intrinsic Pathway for Apoptosis, with its ancestors expanded.
const DEEP = '/PathwayBrowser/R-HSA-109606?path=R-HSA-5357801,R-HSA-109581';
const TREE = 'cr-event-hierarchy';
const SCROLLER = '#events-container';

async function openDeepHierarchy(page: Page) {
  await page.goto(DEEP);
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
  await page.waitForSelector(`${TREE} [role="treeitem"]`, { timeout: BOOT_TIMEOUT });
  await page.waitForTimeout(3000);

  // Open whatever is still closed, so there is something below the fold.
  for (let round = 0; round < 3; round++) {
    const toggles = page.locator(`${TREE} [role="treeitem"] button`);
    const count = await toggles.count();
    let opened = 0;
    for (let index = 0; index < count && opened < 6; index++) {
      const toggle = toggles.nth(index);
      if ((await toggle.getAttribute('aria-expanded').catch(() => null)) === 'false') {
        await toggle.click({ timeout: 5000 }).catch(() => undefined);
        opened++;
        await page.waitForTimeout(250);
      }
    }
    if (!opened) break;
  }
  await page.waitForTimeout(1000);
}

/** Scroll to the bottom and mark a row that is comfortably in view there. */
async function markVisibleRowNearBottom(page: Page) {
  return page.evaluate(async (selector) => {
    const scroller = document.querySelector(selector) as HTMLElement | null;
    if (!scroller) return null;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 400));

    const box = scroller.getBoundingClientRect();
    const rows = [...document.querySelectorAll('cr-event-hierarchy [role="treeitem"]')].filter(
      (row) => {
        const rect = row.getBoundingClientRect();
        return rect.top > box.top + 20 && rect.bottom < box.bottom - 20;
      }
    );
    const pick = rows[Math.floor(rows.length / 2)];
    if (!pick) return null;
    pick.setAttribute('data-pick', '1');
    return { scrollTop: Math.round(scroller.scrollTop), label: (pick.textContent ?? '').trim() };
  }, SCROLLER);
}

const scrollTop = (page: Page) =>
  page.evaluate(
    (selector) => Math.round((document.querySelector(selector) as HTMLElement).scrollTop),
    SCROLLER
  );

test.describe('Event hierarchy scrolling', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('does not move when you click a row you can already see', async ({ page }) => {
    await openDeepHierarchy(page);

    const marked = await markVisibleRowNearBottom(page);
    test.skip(!marked || marked.scrollTop === 0, 'the hierarchy here does not scroll');

    const before = await scrollTop(page);
    await page.locator(`${TREE} [data-pick="1"]`).click();
    // Long enough for the rebuild, the expansion restore and any revealing.
    await page.waitForTimeout(2500);
    const after = await scrollTop(page);

    // This was 274 -> 0 -> 6.
    expect(Math.abs(after - before), `before ${before}, after ${after}`).toBeLessThan(24);
  });

  test('still brings a row you cannot see into view', async ({ page }) => {
    await openDeepHierarchy(page);

    const target = await page.evaluate(async (selector) => {
      const scroller = document.querySelector(selector) as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 400));
      const box = scroller.getBoundingClientRect();
      const above = [...document.querySelectorAll('cr-event-hierarchy [role="treeitem"]')].filter(
        (row) => row.getBoundingClientRect().bottom < box.top
      );
      const pick = above[Math.floor(above.length / 2)];
      if (!pick) return null;
      pick.setAttribute('data-target', '1');
      return { scrollTop: Math.round(scroller.scrollTop), above: above.length };
    }, SCROLLER);

    test.skip(!target || target.above === 0, 'nothing is scrolled out of view here');

    const before = await scrollTop(page);
    // It is off-screen, so dispatch the click rather than asking Playwright to
    // scroll it into view first -- that would defeat the test.
    await page.evaluate(() =>
      document
        .querySelector('[data-target="1"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await page.waitForTimeout(2500);
    const after = await scrollTop(page);

    expect(after, `it should have scrolled up from ${before}`).toBeLessThan(before - 20);
  });
});
