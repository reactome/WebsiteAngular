import { test, expect } from './support/backend';

// The query syntax help is for the search page, where a reader is writing
// searches; on the home page it was a third control in the hero (user, 23 Nov 2026).
const LOAD = 90_000;

test('the home page search has no query syntax help', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Search query' })).toBeVisible({ timeout: LOAD });
  await expect(page.getByRole('button', { name: 'Toggle query syntax help' })).toHaveCount(0);
  // The hero's illustration finished, so the recording holds its whole answer
  await expect
    .poll(
      () =>
        page
          .locator('.home-hero-picture img')
          .evaluate((image) => (image as HTMLImageElement).complete)
          .catch(() => true),
      { timeout: LOAD }
    )
    .toBe(true);
});

test('the search page keeps it, and it opens', async ({ page }) => {
  await page.goto('/content/query?q=TP53');
  const help = page.getByRole('button', { name: 'Toggle query syntax help' });
  await expect(help).toBeVisible({ timeout: LOAD });
  await help.click();
  await expect(page.locator('.syntax-help')).toBeVisible();
});
