import { test, expect } from '@playwright/test';

test.describe('Search flow', () => {
  test('search TP53, click first result, verify detail page', async ({ page }) => {
    await page.goto('/content/query?q=TP53');
    await expect(page.locator('.result-count')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.result-count')).toContainText('results found');

    const firstResult = page.locator('.entry-name').first();
    await expect(firstResult).toBeVisible();
    await firstResult.click();

    await expect(page).toHaveURL(/\/content\/detail\//);
  });

  test('search nonexistent term, verify no-results section', async ({ page }) => {
    await page.goto('/content/query?q=xyzzy_no_match_99999');
    await expect(page.locator('.no-results')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.no-results h2')).toContainText('No results found');
  });

  test('search apoptosis, click a facet, verify filter chip appears', async ({ page }) => {
    await page.goto('/content/query?q=apoptosis');
    await expect(page.locator('.result-count')).toBeVisible({ timeout: 15000 });

    const firstFacet = page.locator('.facet-option').first();
    await expect(firstFacet).toBeVisible();
    await firstFacet.click();

    await expect(page.locator('.filter-chip')).toBeVisible({ timeout: 10000 });
  });
});
