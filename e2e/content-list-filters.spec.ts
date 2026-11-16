import { test, expect } from './support/backend';

/**
 * The lists of pathways, DOIs and contributors narrow as the reader types.
 *
 * The filter runs a moment after the last keystroke, and nothing then told the
 * page to redraw: it showed the rows for the text before, so a term that
 * matches nothing left every row up, and clearing it showed that term's rows.
 *
 * These pages redraw on any change detection in the app, so the failure shows
 * only while nothing else on the page ticks in the second after typing. That
 * holds for these recordings; a page that starts polling would hide it.
 */

const LOAD = 60_000;

for (const { path, box, row } of [
  { path: '/content/toc', box: /Search pathways, species/, row: 'tbody tr' },
  { path: '/content/doi', box: /Search pathways, DOIs/, row: 'tbody tr' },
  { path: '/content/contributors', box: /Search by name or ORCID/, row: 'tbody tr' },
]) {
  test(`${path} shows the rows for what has been typed`, async ({ page }) => {
    await page.goto(path);
    const rows = page.locator(row);
    await expect(rows.first()).toBeVisible({ timeout: LOAD });
    const all = await rows.count();

    // Nothing touches the page after the filter has run: no pointer, no key.
    await page.getByPlaceholder(box).fill('zzqqxyz');
    await expect(rows).toHaveCount(0, { timeout: 3000 });

    await page.getByPlaceholder(box).fill('');
    await expect(rows).toHaveCount(all, { timeout: 3000 });
  });

  // The clear button empties the box without the typed text's stream hearing
  // of it, so the same term typed again looked like no change and was dropped:
  // every row stayed up under "matching" that term.
  test(`${path} filters again for a term typed after clearing it`, async ({ page }) => {
    await page.goto(path);
    const rows = page.locator(row);
    await expect(rows.first()).toBeVisible({ timeout: LOAD });

    await page.getByPlaceholder(box).fill('zzqqxyz');
    await expect(rows).toHaveCount(0, { timeout: 3000 });
    await page.locator('.clear-btn').click();
    await expect(rows.first()).toBeVisible({ timeout: 3000 });

    await page.getByPlaceholder(box).fill('zzqqxyz');
    await expect(rows).toHaveCount(0, { timeout: 3000 });
  });
}

// The icon library searches the service rather than a list it holds, but its
// clear button left the same stream behind: the term typed again found nothing
// to search for, and every icon stayed up.
test('/community/icon-lib searches again for a term typed after clearing it', async ({ page }) => {
  await page.goto('/community/icon-lib');
  const icons = page.locator('.icon-card');
  await expect(icons.first()).toBeVisible({ timeout: LOAD });
  const box = page.getByPlaceholder('Search icons...');

  await box.fill('zzqqxyz');
  await expect(icons).toHaveCount(0, { timeout: 10_000 });
  await page.locator('.clear-btn').click();
  await expect(icons.first()).toBeVisible({ timeout: 10_000 });

  await box.fill('zzqqxyz');
  await expect(icons).toHaveCount(0, { timeout: 10_000 });
});
