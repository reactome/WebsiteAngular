import type { Page } from '@playwright/test';
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
  // answered here, not fetched: the service gives up after 10 seconds, and a
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

// A failed statistics file was shown as a release of nothing: "0 Human
// Pathways, 0 Reactions ..." (#321). The counters also read 0 while it loaded.
test('the release counters say so when the numbers cannot be loaded', async ({ page }) => {
  let answer!: () => void;
  const asked = new Promise<void>((resolve) => (answer = resolve));
  await page.route('**/stats/summary_stats.json', async (route) => {
    await asked;
    await route.fulfill({ status: 500, contentType: 'text/plain', body: 'stats failed' });
  });
  await page.goto('/');
  const stats = page.locator('app-home-stats');
  await expect(stats.getByText('Human Pathways')).toBeVisible({ timeout: 60_000 });
  // Not yet known is not zero.
  await expect(stats.locator('.stat-item span').first()).toHaveText('–');

  answer();
  await expect(stats.getByRole('alert')).toContainText("Couldn't load the release statistics", {
    timeout: 30_000,
  });
  await expect(stats).not.toContainText('Human Pathways');
});

// The statistics file is named by release, so a release number that cannot be
// had means no statistics either -- and reading the failed number threw on
// every redraw, which left the message an icon with no words. Whether the words
// made it depended on timing, so the throw itself is what is checked.
async function failTheRelease(page: Page) {
  const thrown: string[] = [];
  // Anything Angular reports ("ERROR <error>"), not just ResourceValueError by
  // name: a production build minifies that class away. And anything uncaught.
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  await page.route(/\/data\/database\/version/, (route) =>
    route.fulfill({ status: 500, contentType: 'text/plain', body: 'version failed' })
  );
  return thrown;
}

test('the release counters say so when the release cannot be had', async ({ page }) => {
  const thrown = await failTheRelease(page);
  await page.goto('/');
  const stats = page.locator('app-home-stats');
  await expect(stats.getByRole('alert')).toContainText("Couldn't load the release statistics", {
    timeout: 60_000,
  });
  expect(thrown).toEqual([]);
});

test('the pathway browser header draws without the release', async ({ page }) => {
  const thrown = await failTheRelease(page);
  // No pathway: a diagram cannot be had without the release either (its files
  // are named by it), and that is a separate failure from the header's.
  await page.goto('/PathwayBrowser');
  await expect(page.locator('.version-container .beta')).toBeVisible({ timeout: 60_000 });
  // Long enough for redraws after the version has failed.
  await page.waitForTimeout(3000);
  expect(thrown).toEqual([]);
  // No version is shown rather than a "v" with nothing after it.
  await expect(page.locator('.version-container .version')).toHaveCount(0);
});
