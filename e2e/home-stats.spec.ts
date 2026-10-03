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
  // Held back until the page has settled, so nothing else redraws it -- and
  // answered here, not fetched: the service gives up after 5 seconds, and a
  // slow fetch on top of the wait failed this for reasons of its own. The
  // file's own shape, from download.reactome.org.
  await page.route('**/stats/summary_stats.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        { name: 'pathway', value: '2883' },
        { name: 'rxn', value: '16423' },
        { name: 'netProt', value: '11469' },
        { name: 'chemicals', value: '2188' },
        { name: 'chemDrug', value: '1000' },
        { name: 'protDrug', value: '102' },
        { name: 'litRef', value: '43308' },
      ]),
    });
  });
  await page.goto('/');
  const pathways = page.locator('app-home-stats span').first();
  await expect(pathways).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => Number((await pathways.textContent())?.replace(/[^0-9]/g, '') || 0), {
      timeout: 30_000,
    })
    .toBe(2883);
});
