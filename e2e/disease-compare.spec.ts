import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';
import { HOST_PAGE_PORT } from './support/embed-ports';

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
// MPS VII - Sly syndrome: another, to switch to.
const OTHER_DISEASE = 'R-HSA-2206292';
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

// The diagram's own toggle, named for what it will do; the Pathway Browser
// has other buttons that compare.
const compareButton = (page: Page) =>
  page
    .locator('cr-diagram')
    .getByRole('button', { name: /^(Compare with normal|Close comparison)$/ });

/** The diagram component, as the page's dev tools reach it: only what is used here. */
type DiagramProbe = {
  ng: {
    getComponent(element: Element | null): {
      cy: {
        elements(selector: string): {
          filter(test: (element: { visible(): boolean }) => boolean): { length: number };
        };
        panBy(by: { x: number; y: number }): unknown;
      };
    };
  };
};

/** How many of the normal pathway's replaced or crossed-out elements show. */
const normalVersionsShown = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as DiagramProbe).ng.getComponent(
      document.querySelector('cr-diagram')
    );
    const shown = (selector: string) => c.cy.elements(selector).filter((e) => e.visible()).length;
    return shown('[?replacedBy]') + shown('[?isCrossed]');
  });
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

  test('stays the disease alone when the reader pans it', async ({ page }) => {
    // Which normal-pathway elements show is decided by where the layer's edge
    // falls in the diagram; at the viewport's edge, panning used to bring them
    // back -- the normal version of a replaced entity, under the disease one.
    await open(page, DISEASE);
    expect(await normalVersionsShown(page)).toBe(0);
    for (const dx of [-1200, 1200]) {
      // In small steps, as a drag pans: each step is a viewport change. And
      // nothing returned: panBy answers with the whole graph, which Playwright
      // would try to copy out of the page.
      await page.evaluate(async (dx) => {
        const cy = (window as unknown as DiagramProbe).ng.getComponent(
          document.querySelector('cr-diagram')
        ).cy;
        for (let i = 0; i < 10; i++) {
          cy.panBy({ x: dx / 10, y: 0 });
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }, dx);
      await page.waitForTimeout(300);
      expect(await normalVersionsShown(page), `after panning ${dx}px`).toBe(0);
    }
  });

  test('a second click while it slides out brings it back', async ({ page }) => {
    await open(page, DISEASE);
    await compareButton(page).click();
    await expect(handle(page)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(compareButton(page)).toHaveText(/Close comparison/);
    await compareButton(page).click();
    // At once -- not once the slide has finished -- it says what it will do.
    expect(await compareButton(page).textContent()).toMatch(/Compare with normal/);
    // And a click before the slide is over reverses it.
    await compareButton(page).click();
    expect(await compareButton(page).textContent()).toMatch(/Close comparison/);
    await page.waitForTimeout(800);
    await expect(handle(page)).toBeVisible();
    await expect.poll(() => layerStart(page)).toBeGreaterThan(200);
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

  test('a pathway switched to mid-comparison opens uncompared', async ({ page }) => {
    // In the embed, where a page changes the pathway in place, as the Pathway
    // Browser does on a double-click: the comparison started on one disease
    // pathway must not carry over, half-slid, to the next.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(() => {
      const w = window as unknown as { __loaded: string[] };
      w.__loaded = [];
      document.addEventListener('diagramloaded', (e) =>
        w.__loaded.push((e as CustomEvent<{ pathway: string }>).detail.pathway)
      );
    });
    await page.goto(`http://localhost:${HOST_PAGE_PORT}/configurable.html?pathway=${DISEASE}`);
    const view = page.locator('#diagram reactome-diagram-view');
    const toggle = view.getByRole('button', { name: /^(Compare with normal|Close comparison)$/ });
    await expect(toggle).toBeVisible({ timeout: LOAD });
    await toggle.click();
    // Straight away, while it is still sliding in, to another disease pathway.
    await page.evaluate(
      (other) => document.getElementById('diagram')?.setAttribute('pathway', other),
      OTHER_DISEASE
    );
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loaded: string[] }).__loaded), {
        timeout: LOAD,
      })
      .toContain(OTHER_DISEASE);
    await expect(toggle).toHaveText(/Compare with normal/);
    await page.waitForTimeout(800);
    await expect(view.locator('#disease-handle')).toHaveCount(0);
    expect(
      await view
        .locator('#disease-container')
        .evaluate((layer) => (layer as HTMLElement).style.left)
    ).toBe('0px');
  });
});
