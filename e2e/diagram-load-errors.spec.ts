import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A request that fails is not an answer of "nothing".
 *
 * The analysis overlay and flagging both turned any failure into an empty
 * result, so a server error drew the diagram exactly as an analysis that hit
 * nothing in it, or a search term that is not in it. Only a 404 means that;
 * anything else is said on the diagram.
 */

const LOAD = 60_000;
const PATHWAY = 'R-HSA-69620';
// An existing result, read only: nothing is submitted. It finds entities in
// R-HSA-69620.
const TOKEN = 'MjAyNjA5MjUxNDM3NThfMTM=';
// CHEK1 occurs in Cell Cycle Checkpoints.
const FLAG = 'CHEK1';

/** Anything Angular reports ("ERROR <error>"), and anything uncaught. */
function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

/** Answers these requests with this status, counting them as it does. */
async function answer(page: Page, url: RegExp, status: number) {
  const answered = { count: 0 };
  await page.route(url, (route) => {
    answered.count += 1;
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: status }),
    });
  });
  return answered;
}

/** How many nodes carry an analysis value, "not hit" included. */
const analysed = (page: Page) =>
  page.evaluate<number>(`(() => {
    const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
    return cy ? cy.nodes().filter((n) => n.data('exp') !== undefined).length : -1;
  })()`);

/** How many nodes are drawn: the analysis may fail before the diagram is. */
const drawn = (page: Page) =>
  page.evaluate<number>(`(() => {
    const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
    return cy ? cy.nodes().length : 0;
  })()`);

const diagram = (page: Page) => page.locator('cr-diagram');

/**
 * Watches the analysis service's traffic; `quiet()` resolves once nothing has
 * been asked of it, or is still being answered, for a second. What
 * networkidle was being used for -- it resolves at once when the navigation
 * reached it earlier, so it waited for nothing.
 */
function analysisTraffic(page: Page) {
  let inFlight = 0;
  let last = Date.now();
  const mine = (url: string) => url.includes('/AnalysisService/');
  page.on('request', (request) => {
    if (!mine(request.url())) return;
    inFlight += 1;
    last = Date.now();
  });
  const done = (request: { url(): string }) => {
    if (!mine(request.url())) return;
    inFlight -= 1;
    last = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return {
    quiet: () =>
      expect.poll(() => inFlight === 0 && Date.now() - last > 1_000, { timeout: LOAD }).toBe(true),
  };
}

test.describe('The analysis overlay', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('says so when the pathway’s results cannot be loaded, and colours nothing', async ({
    page,
  }) => {
    const thrown = collectThrown(page);
    const refused = await answer(page, /\/AnalysisService\/token\/[^/]+\/found\/all\//, 500);
    await page.goto(`/PathwayBrowser/${PATHWAY}?analysis=${encodeURIComponent(TOKEN)}`);
    await expect(diagram(page).getByRole('alert')).toContainText(
      "Couldn't load the analysis results for this diagram, so nothing is coloured.",
      { timeout: LOAD }
    );
    await expect.poll(() => drawn(page), { timeout: LOAD }).toBeGreaterThan(0);
    // The drawn diagram loads the analysis again: count only once that load
    // has been refused too. networkidle could not say so -- it had already
    // been reached for this navigation, so it waited for nothing.
    await expect.poll(() => refused.count, { timeout: LOAD }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(500);
    expect(await analysed(page)).toBe(0);
    expect(thrown).toEqual([]);
  });

  test('says so when its sub-pathways’ results cannot be loaded', async ({ page }) => {
    const thrown = collectThrown(page);
    const traffic = analysisTraffic(page);
    const refused = await answer(page, /\/AnalysisService\/token\/[^/]+\/filter\/pathways/, 500);
    await page.goto(`/PathwayBrowser/${PATHWAY}?analysis=${encodeURIComponent(TOKEN)}`);
    await expect(diagram(page).getByRole('alert')).toContainText(
      "Couldn't load the analysis results for this diagram, so nothing is coloured.",
      { timeout: LOAD }
    );
    await expect.poll(() => drawn(page), { timeout: LOAD }).toBeGreaterThan(0);
    // Once the refusal has been answered and the analysis service has gone
    // quiet: the overlay is drawn from what came back, or nothing is.
    await expect.poll(() => refused.count, { timeout: LOAD }).toBeGreaterThanOrEqual(1);
    await traffic.quiet();
    expect(await analysed(page)).toBe(0);
    expect(thrown).toEqual([]);
  });

  test('still draws a pathway the analysis did not hit as not hit, saying nothing', async ({
    page,
  }) => {
    const thrown = collectThrown(page);
    // What the Analysis Service answers for a pathway outside the result.
    await answer(page, /\/AnalysisService\/token\/[^/]+\/found\/all\//, 404);
    await page.goto(`/PathwayBrowser/${PATHWAY}?analysis=${encodeURIComponent(TOKEN)}`);
    await expect.poll(() => analysed(page), { timeout: LOAD }).toBeGreaterThan(0);
    await expect(diagram(page).getByRole('alert')).toHaveCount(0);
    expect(thrown).toEqual([]);
  });

  test('a hit pathway’s matches say so when they cannot be loaded', async ({ page }) => {
    const thrown = collectThrown(page);
    await answer(page, /\/AnalysisService\/token\/[^/]+\/found\/all\//, 500);
    await page.goto(`/PathwayBrowser/${PATHWAY}?analysis=${encodeURIComponent(TOKEN)}&tab=results`);
    await page.locator('button.expand-button').first().click({ timeout: LOAD });
    const found = page.locator('cr-found-table');
    await expect(found.getByRole('alert')).toContainText(
      "Couldn't load the identifiers found in this pathway.",
      { timeout: LOAD }
    );
    // Not an empty table beneath it, which reads as nothing found.
    await expect(found.locator('table')).toBeHidden();
    expect(thrown).toEqual([]);
  });
});

test.describe('Flagging', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('says so when the diagram cannot be searched', async ({ page }) => {
    const thrown = collectThrown(page);
    await answer(page, /\/ContentService\/search\/diagram\/[^/]+\/flag/, 500);
    await page.goto(`/PathwayBrowser/${PATHWAY}?flag=${FLAG}`);
    const banner = diagram(page).locator('cr-flag-banner');
    await expect(banner.getByRole('alert')).toContainText(
      "Couldn't search for the flagged items.",
      { timeout: LOAD }
    );
    // What is flagged, and the way out of it, are still there.
    await expect(banner).toContainText(`Flagged: ${FLAG}`);
    await expect(banner.getByRole('button', { name: 'Clear flagged elements' })).toBeVisible();
    expect(thrown).toEqual([]);
  });

  test('a term that is not in the diagram is no failure', async ({ page }) => {
    const thrown = collectThrown(page);
    // ContentService answers 404 for a term with no match in the diagram.
    const flagged = page.waitForResponse(/\/search\/diagram\/[^/]+\/flag/, { timeout: LOAD });
    await page.goto(`/PathwayBrowser/${PATHWAY}?flag=ZZZNOTAGENE`);
    const banner = diagram(page).locator('cr-flag-banner');
    await expect(banner).toContainText('Flagged: ZZZNOTAGENE', { timeout: LOAD });
    // After the search's own answer, not networkidle, which may already have
    // been reached; then long enough for an alert to have been drawn.
    await flagged;
    await page.waitForTimeout(500);
    await expect(banner.getByRole('alert')).toHaveCount(0);
    expect(thrown).toEqual([]);
  });
});
