import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A diagram that cannot be loaded says so.
 *
 * Diagram files are fetched from a path named by the release version. When the
 * version could not be found, or the files themselves failed, the pathway
 * browser drew an empty canvas and said nothing (#398).
 *
 * Every failure here is an aborted request, not a stubbed answer: an aborted
 * request is not recorded, so it cannot become another test's reply (#404).
 */

const LOAD = 60_000;
// A diagram and no illustration.
const DIAGRAM = 'R-HSA-69620';
// An illustration (EHLD).
const ILLUSTRATED = 'R-HSA-1640170';

const version = /\/data\/database\/version(\?|$)/;
const diagramFile = new RegExp(`/diagram/${DIAGRAM}\\.json(\\?|$)`);

const fail = (page: Page, url: RegExp) => page.route(url, (route) => route.abort('failed'));

/** Anything Angular reports ("ERROR <error>"), and anything uncaught. */
function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

test.describe('A pathway diagram', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('says so when the release it is filed under cannot be found', async ({ page }) => {
    const thrown = collectThrown(page);
    await fail(page, version);
    await page.goto(`/PathwayBrowser/${DIAGRAM}`);
    await expect(page.locator('cr-diagram [role="alert"]')).toHaveText(
      'This diagram could not be shown. Please try again later.',
      { timeout: LOAD }
    );
    expect(thrown).toEqual([]);
  });

  test('says so when its files cannot be loaded', async ({ page }) => {
    await fail(page, diagramFile);
    await page.goto(`/PathwayBrowser/${DIAGRAM}`);
    await expect(page.locator('cr-diagram [role="alert"]')).toHaveText(
      'This diagram could not be shown. Please try again later.',
      { timeout: LOAD }
    );
  });

  test('says nothing when it loads', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${DIAGRAM}`);
    await page.waitForSelector('cr-diagram #cytoscape canvas', { timeout: 90_000 });
    await expect(page.locator('cr-diagram [role="alert"]')).toHaveCount(0);
  });

  test('an illustration says so when the release cannot be found', async ({ page }) => {
    await fail(page, version);
    await page.goto(`/PathwayBrowser/${ILLUSTRATED}`);
    await expect(page.locator('cr-ehld [role="alert"]')).toContainText(
      'This illustration could not be loaded.',
      { timeout: LOAD }
    );
  });
});
