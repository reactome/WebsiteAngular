import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A request that fails is not an article with nothing in it.
 *
 * The news and research spotlight pages turned every failure to load an
 * article, a missing one included, into an article with no title, no text and
 * today's date. The home page's spotlight threw when the full article failed,
 * and showed no text.
 */

const LOAD = 60_000;
const ARTICLE = { path: '/about/news/98-version-63-released', title: 'Version 63 Released' };
const FAILING = '/about/news/97-updated-license-agreement';

const file = (route: string) => new RegExp(`/content${route}\\.json(\\?|$)`);
// Every spotlight article, but not the index that lists them.
const spotlightArticle =
  /\/content\/content\/reactome-research-spotlight\/(?!index\.json)[^/?]+\.json/;

function failWith(page: Page, url: RegExp, status: number) {
  return page.route(url, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: status }),
    })
  );
}

/** Anything Angular reports ("ERROR <error>"), and anything uncaught. */
function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

test.describe('A news article', () => {
  test('shows the article', async ({ page }) => {
    await page.goto(ARTICLE.path);
    await expect(page.locator('h1.article-title')).toHaveText(ARTICLE.title, { timeout: LOAD });
  });

  test('says an article that does not exist was not found', async ({ page }) => {
    await page.goto('/about/news/no-such-article');
    await expect(page.getByRole('heading', { name: "We can't find that article" })).toBeVisible({
      timeout: LOAD,
    });
    await expect(page.locator('article.article')).toHaveCount(0);
  });

  test('does not show an article it could not load as an empty one', async ({ page }) => {
    await failWith(page, file(FAILING), 500);
    await page.goto(FAILING);
    await expect(page.getByRole('alert')).toContainText(
      "Couldn't load this article. Please try again later.",
      { timeout: LOAD }
    );
    await expect(page.locator('article.article')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: "We can't find that article" })).toHaveCount(0);
  });
});

test.describe("The home page's research spotlight", () => {
  test("shows the spotlight's summary when the full article could not be loaded", async ({
    page,
  }) => {
    const thrown = collectThrown(page);
    await failWith(page, spotlightArticle, 500);
    const failed = page.waitForResponse(spotlightArticle);
    await page.goto('/');
    await failed;
    const spotlight = page.locator('app-home-spotlight');
    await expect(spotlight.locator('a.home-spotlight-link')).toBeVisible({ timeout: LOAD });
    await expect(spotlight.locator('p.home-spotlight-text')).toContainText(/\w{3}/);
    expect(thrown).toEqual([]);
  });
});
