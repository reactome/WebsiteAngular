import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A request that fails is not an answer of "none".
 *
 * The pathway browser said "No diagram is available for this pathway" when
 * the pathway, or the lineage it needs to find its parent's diagram, could not
 * be loaded; and dropped "Other Pathways" for an entity whose list failed, as
 * if it took part in no other pathway. Only a 404 means none.
 *
 * Every failure is an aborted request: an aborted request is never replayed to
 * another test (#404).
 */

const LOAD = 90_000;
// A diagram of its own.
const DIAGRAM = 'R-HSA-69620';
// No diagram of its own: drawn in its parent's.
const SUBPATHWAY = 'R-HSA-69541';
// Not a pathway: the service answers 404.
const MISSING = 'R-HSA-0000001';
// CDC25A, in Cell Cycle Checkpoints and seven other pathways.
const ENTITY = 'R-HSA-143487';

const fail = (page: Page, url: RegExp) => page.route(url, (route) => route.abort('failed'));
const view = (page: Page) => page.locator('#view');
const details = (page: Page) => page.locator('cr-description-tab');

/** Anything Angular reports ("ERROR <error>"), and anything uncaught. */
function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

test.describe('The pathway browser', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('does not say a pathway has no diagram when it could not be loaded', async ({ page }) => {
    const thrown = collectThrown(page);
    await fail(page, new RegExp(`/data/query/enhanced/v2/${DIAGRAM}(\\?|$)`));
    await page.goto(`/PathwayBrowser/${DIAGRAM}`);
    await expect(view(page).getByRole('alert')).toHaveText(
      "Couldn't load this pathway. Please try again later.",
      { timeout: LOAD }
    );
    await expect(view(page)).not.toContainText('No diagram is available');
    expect(thrown).toEqual([]);
  });

  test('does not say a sub-pathway has no diagram when its parents could not be loaded', async ({
    page,
  }) => {
    await fail(page, new RegExp(`/data/event/${SUBPATHWAY}/ancestors(\\?|$)`));
    await page.goto(`/PathwayBrowser/${SUBPATHWAY}`);
    await expect(view(page).getByRole('alert')).toHaveText(
      "Couldn't load this pathway. Please try again later.",
      { timeout: LOAD }
    );
    await expect(view(page)).not.toContainText('No diagram is available');
  });

  test('says a pathway that does not exist was not found', async ({ page }) => {
    const thrown = collectThrown(page);
    await page.goto(`/PathwayBrowser/${MISSING}`);
    await expect(view(page).locator('.no-diagram')).toContainText(
      `There is no pathway ${MISSING}.`,
      { timeout: LOAD }
    );
    await expect(view(page).getByRole('alert')).toHaveCount(0);
    expect(thrown).toEqual([]);
  });

  test('draws a sub-pathway in its parent’s diagram', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${SUBPATHWAY}`);
    await page.waitForSelector('cr-diagram #cytoscape canvas', { timeout: LOAD });
    await expect(view(page).getByRole('alert')).toHaveCount(0);
  });

  test('lists the other pathways an entity takes part in', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${DIAGRAM}?select=${ENTITY}`);
    await expect(details(page).locator('.other-pathway').first()).toBeVisible({ timeout: LOAD });
  });

  test('says so when the other pathways could not be loaded', async ({ page }) => {
    await fail(page, new RegExp(`/data/pathways/low/entity/${ENTITY}(\\?|$)`));
    await page.goto(`/PathwayBrowser/${DIAGRAM}?select=${ENTITY}`);
    await expect(details(page).getByRole('alert')).toHaveText(
      "Couldn't load the other pathways this takes part in. Please try again later.",
      { timeout: LOAD }
    );
  });
});
