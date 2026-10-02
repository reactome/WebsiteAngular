import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A disease pathway, and comparing it with the normal one.
 *
 * It opens on the disease diagram alone, as a reader wants it first: in full
 * colour, the normal pathway's faded elements gone, the disease's changes
 * marked (what is crossed out, what replaces what). Compare brings in a handle
 * that slides between the normal pathway, on its left, and the disease, on its
 * right; closing it slides back to the disease alone.
 *
 * The handle used to follow the pointer only while the pointer stayed inside a
 * box around it, so a quick drag, or one that drifted off its row, left it
 * where it was.
 */

// MPS IX - Natowicz syndrome: a disease pathway drawn over its normal one.
const DISEASE = 'R-HSA-2206280';
// Cell Cycle Checkpoints: no disease, nothing to compare.
const NORMAL = 'R-HSA-69620';
const LOAD = 90_000;

async function open(page: Page, stId: string) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/PathwayBrowser/${stId}`);
  await page.waitForFunction(
    () => {
      const c = document.querySelector('cr-diagram #cytoscape') as
        (HTMLElement & { _cyreg?: { cy?: { nodes(): { length: number } } } }) | null;
      return (c?._cyreg?.cy?.nodes().length ?? 0) > 0;
    },
    null,
    { timeout: LOAD }
  );
}

// The diagram's own toggle; the Pathway Browser has other buttons that compare.
const compareButton = (page: Page) =>
  page.locator('cr-diagram').getByRole('button', { name: 'Compare with the normal pathway' });
const handle = (page: Page) => page.locator('#disease-handle');

/** Where the disease layer begins, from the diagram's left edge: 0 is the disease alone. */
const layerStart = (page: Page) =>
  page.evaluate(() => {
    const layer = document.getElementById('disease-container');
    const view = document.querySelector('cr-diagram #cytoscape');
    if (!layer || !view) return null;
    return Math.round(layer.getBoundingClientRect().x - view.getBoundingClientRect().x);
  });

test.describe('a disease pathway, and its comparison with the normal one', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('opens on the disease diagram alone, with no handle', async ({ page }) => {
    await open(page, DISEASE);
    await expect(compareButton(page)).toBeVisible();
    await expect(handle(page)).toHaveCount(0);
    await expect.poll(() => layerStart(page)).toBe(0);
    // Not greyed out: the disease layer covers the whole diagram, and its tint
    // over the whole width washed every unchanged entity out.
    await expect(page.locator('#cytoscape-compare')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    );
  });

  test('compare brings the handle in, and it follows a quick drag', async ({ page }) => {
    await open(page, DISEASE);
    await compareButton(page).click();
    await expect(handle(page)).toBeVisible();
    await expect.poll(() => layerStart(page)).toBeGreaterThan(200);
    await page.waitForTimeout(600);

    const box = await handle(page).boundingBox();
    if (!box) throw new Error('the handle has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const start = await layerStart(page);
    // As a hand drags: two big steps, the second off the handle's row.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 150, y + 40);
    await page.mouse.move(x - 300, y + 200);
    await page.mouse.up();
    await expect
      .poll(async () => (start ?? 0) - ((await layerStart(page)) ?? 0))
      .toBeGreaterThan(280);
  });

  test('closing the comparison slides back to the disease diagram alone', async ({ page }) => {
    await open(page, DISEASE);
    await compareButton(page).click();
    await expect(handle(page)).toBeVisible();
    await compareButton(page).click();
    await expect(handle(page)).toHaveCount(0);
    await expect.poll(() => layerStart(page)).toBe(0);
  });

  test('a pathway with no disease has nothing to compare', async ({ page }) => {
    await open(page, NORMAL);
    await expect(compareButton(page)).toHaveCount(0);
  });
});
