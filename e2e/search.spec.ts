import { test, expect } from './support/backend';

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
    // `.no-results` alone is ambiguous -- the facet sidebar also takes it as a
    // modifier class (aside.facet-sidebar.no-results). Target the message.
    const message = page.locator('div.no-results');
    await expect(message).toBeVisible({ timeout: 15000 });
    // The block holds two headings (the message and a "report to us" prompt).
    await expect(message.getByRole('heading', { name: /No results found/ })).toBeVisible();
  });

  test('search apoptosis, click a facet, verify filter chip appears', async ({ page }) => {
    await page.goto('/content/query?q=apoptosis');
    await expect(page.locator('.result-count')).toBeVisible({ timeout: 15000 });

    const firstFacet = page.locator('.facet-option').first();
    await expect(firstFacet).toBeVisible();
    await firstFacet.click();

    await expect(page.locator('.filter-chip')).toBeVisible({ timeout: 10000 });
  });

  test('the sidebar offers Pages above Keywords', async ({ page }) => {
    // Site Search used to be one of four top-level search modes. Unifying the
    // page into a single bar turned it into a sidebar facet, and it was
    // appended after the four biology ones -- last, under a long list of
    // auto-extracted keywords, and only rendered when the query happens to hit
    // site pages. It read as missing, and was reported as such.
    //
    // The order is the point of that change, so it is asserted rather than left
    // to whoever edits this template next.
    await page.goto('/content/query?q=apoptosis');
    await expect(page.locator('.result-count')).toBeVisible({ timeout: 15000 });

    const titles = await page.locator('.facet-title').allTextContents();
    const order = titles.map((t) => t.replace(/[−+]/g, '').trim());

    expect(order, 'Pages is missing; it only renders when the query hits site pages').toContain(
      'Pages'
    );
    expect(order.indexOf('Pages')).toBeLessThan(order.indexOf('Keywords'));
  });
});
