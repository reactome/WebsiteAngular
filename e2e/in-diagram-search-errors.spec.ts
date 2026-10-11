import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A search that fails is not a search that found nothing.
 *
 * The pathway browser's search turned every failure but a 404 into an empty
 * answer, which it then did not show at all: the reader searched and nothing
 * happened. A later page failing emptied the whole list, and was never asked
 * for again.
 */

const LOAD = 60_000;
const DNA_DAMAGE_BYPASS = 'R-HSA-73893';

const local = /\/ContentService\/search\/diagram\//;
const global = /\/ContentService\/search\/fireworks\//;

/**
 * Fails the matching search requests until the returned function is called:
 * with a 500, or with no answer at all when `abort` is set.
 *
 * A request that is asked for again after it failed has to fail by aborting: a
 * recorded 500 would be what replay answered the retry with.
 */
async function fail(
  page: Page,
  url: RegExp,
  { when = () => true, abort = false }: { when?: (url: URL) => boolean; abort?: boolean } = {}
) {
  const handler = (route: import('@playwright/test').Route) =>
    !when(new URL(route.request().url()))
      ? route.fallback()
      : abort
        ? route.abort('failed')
        : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  await page.route(url, handler);
  return () => page.unroute(url, handler);
}

async function search(page: Page, term: string) {
  await page.goto(`/PathwayBrowser/${DNA_DAMAGE_BYPASS}`);
  await page.waitForSelector('#cytoscape canvas', { timeout: 90_000 });
  await page.locator('cr-search input').first().fill(term);
  await page.locator('cr-search .search-icon').first().click();
}

const alert = (page: Page) => page.locator('cr-search [role="alert"]');
const scope = (page: Page, name: string) => page.locator('cr-search .scope', { hasText: name });

test.describe('In-diagram search', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  test('says so when it cannot search at all', async ({ page }) => {
    await fail(page, local);
    await fail(page, global);
    await search(page, 'USP10');
    await expect(alert(page)).toContainText("Couldn't search right now. Please try again later.", {
      timeout: LOAD,
    });
  });

  test('says so when the current pathway cannot be searched, and shows the rest', async ({
    page,
  }) => {
    await fail(page, local);
    const answered = page.waitForResponse(global);
    await search(page, 'USP10');
    await answered;
    await expect(scope(page, 'All pathways')).toBeVisible({ timeout: LOAD });
    await expect(page.locator('cr-search .result-row').first()).toContainText(/\w/);
    await expect(alert(page)).toContainText("Couldn't search the current pathway.");
  });

  test('keeps what it found when a later page fails, and asks for it again', async ({ page }) => {
    // 188 hits across all pathways: more than the first page of 30.
    const restore = await fail(page, global, {
      when: (url) => url.searchParams.get('start') === '30',
      abort: true,
    });
    await search(page, 'PCNA');
    const all = scope(page, 'All pathways');
    await expect(all).toBeVisible({ timeout: LOAD });
    await all.click();
    const count = all.locator('.count');
    const found = await count.innerText();
    expect(Number(found)).toBeGreaterThan(30);

    const failed = page.waitForEvent('requestfailed', (request) => global.test(request.url()));
    const scroller = page.locator('cr-search cdk-virtual-scroll-viewport');
    await scroller.evaluate((element) => (element.scrollTop = 30 * 24));
    await failed;
    await expect(alert(page)).toContainText(
      "Some results couldn't be loaded. Scroll to try again."
    );
    await expect(count).toHaveText(found);
    await scroller.evaluate((element) => (element.scrollTop = 0));
    await expect(page.locator('cr-search .result-row').first()).toContainText(/\w/);

    await restore();
    const retried = page.waitForResponse(
      (response) =>
        global.test(response.url()) &&
        new URL(response.url()).searchParams.get('start') === '30' &&
        response.ok()
    );
    await scroller.evaluate((element) => (element.scrollTop = 30 * 24));
    await retried;
    await expect(alert(page)).toHaveCount(0);
  });
});
