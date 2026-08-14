import { test, expect } from '@playwright/test';

// Coverage for the content pages and shared navigation chrome.
//
// These exist because the rest of the suite reported 24/24 green while the
// sidebar and breadcrumbs rendered completely empty: nothing exercised those
// pages, so a whole class of breakage was invisible. Each component here builds
// its state in an async callback (route params, HTTP, or a dynamic import) and
// then renders it, which is exactly the pattern that fails silently when
// Angular is not told the state changed -- a stale view throws no error.
//
// Every assertion below is on real content arriving from the backend or the
// CMS, not on a container element existing, so an empty render fails.

const LOAD = 45_000;

test.describe('Shared navigation chrome', () => {
  // sidebar.component.ts and breadcrumb.component.ts build their items from
  // route segments combined with the asynchronously loaded nav options.
  for (const { url, minItems, minCrumbs } of [
    { url: '/documentation/userguide', minItems: 5, minCrumbs: 2 },
    { url: '/about/news', minItems: 5, minCrumbs: 2 },
  ]) {
    test(`sidebar and breadcrumbs populate on ${url}`, async ({ page }) => {
      await page.goto(url);
      const items = page.locator('app-sidebar a, app-sidebar li');
      await expect(items.first()).toBeVisible({ timeout: LOAD });
      expect(await items.count()).toBeGreaterThanOrEqual(minItems);

      const crumbs = page.locator('app-breadcrumb a, app-breadcrumb span');
      expect(await crumbs.count()).toBeGreaterThanOrEqual(minCrumbs);
    });
  }
});

test.describe('Content pages render backend data', () => {
  test('data schema lists classes with instance counts', async ({ page }) => {
    // schema.component.ts carries the most async-assigned state in the app.
    await page.goto('/content/schema');
    await expect(page.getByText('DatabaseObject').first()).toBeVisible({ timeout: LOAD });
    // Counts come from the content service; their presence proves real data.
    await expect(page.locator('body')).toContainText(/\[\s*\d[\d,]*\s*\]|\d[\d,]*\s+instances/, {
      timeout: LOAD,
    });
  });

  test('table of contents lists pathways', async ({ page }) => {
    await page.goto('/content/toc');
    await expect(page.getByText(/Metabolism|Signal Transduction|Immune System/).first()).toBeVisible({
      timeout: LOAD,
    });
  });

  test('DOI page lists pathways', async ({ page }) => {
    await page.goto('/content/doi');
    // Every row is a DOI-registered pathway; the prefix is stable.
    await expect(page.getByText(/10\.\d{4,}/).first()).toBeVisible({ timeout: LOAD });
  });

  test('contributors page lists people', async ({ page }) => {
    await page.goto('/community/contributors');
    const links = page.locator('a[href*="/content/detail/person/"]');
    await expect(links.first()).toBeVisible({ timeout: LOAD });
  });

  test('icon library lists icons', async ({ page }) => {
    await page.goto('/community/icon-lib');
    await expect(page.locator('img, svg').first()).toBeVisible({ timeout: LOAD });
    await expect(page.locator('body')).not.toContainText('Loading', { timeout: LOAD });
  });

  test('a CMS article page renders its body', async ({ page }) => {
    // page.component.ts fetches the compiled content JSON and renders markdown.
    await page.goto('/documentation/userguide');
    const main = page.locator('app-page, article, main').first();
    await expect(main).toBeVisible({ timeout: LOAD });
    const text = await main.innerText();
    expect(text.trim().length).toBeGreaterThan(200);
  });

  test('release calendar renders entries', async ({ page }) => {
    await page.goto('/about/release-calendar');
    await expect(page.getByText(/20\d\d/).first()).toBeVisible({ timeout: LOAD });
  });
});
