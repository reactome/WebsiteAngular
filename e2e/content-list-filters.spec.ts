import { test, expect } from './support/backend';

/**
 * The lists of pathways, DOIs and contributors narrow as the reader types.
 *
 * The filter runs a moment after the last keystroke, and nothing then told the
 * page to redraw: it showed the rows for the text before, so a term that
 * matches nothing left every row up, and clearing it showed that term's rows.
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
}
