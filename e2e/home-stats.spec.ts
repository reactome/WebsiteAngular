import { test, expect } from './support/backend';

/**
 * The home page's release counters (pathways, reactions, proteins, ...).
 *
 * They are filled in when the statistics file arrives, after the page has
 * drawn. In this zoneless app a plain field written then was not drawn: the
 * counters showed 0 unless something else on the page happened to redraw it,
 * and in development a reply landing mid-check threw NG0100.
 */
test('the release counters show the numbers once they arrive, however late', async ({ page }) => {
  // Held back until the page has settled, so nothing else redraws it.
  await page.route('**/stats/summary_stats.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fallback();
  });
  await page.goto('/');
  const pathways = page.locator('app-home-stats span').first();
  await expect(pathways).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => Number((await pathways.textContent())?.replace(/[^0-9]/g, '') || 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
});
