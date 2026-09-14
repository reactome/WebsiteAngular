import { test, expect, type Page } from '@playwright/test';

// Diagram behaviours from the release checklist that are not about a single
// pathway drawing: the key being on screen, and the species switch still drawing
// a diagram after it changes the pathway underneath.
//
// A sub-pathway is used deliberately: a top-level pathway renders an EHLD
// illustration rather than the interactive diagram.
const PATHWAY = '/PathwayBrowser/R-HSA-109606?tab=info';
const BOOT = 90_000;

/** Wait until cytoscape has actually laid the diagram out, not merely mounted. */
async function drawnDiagram(page: Page) {
  const container = page.locator('#cytoscape').first();
  await expect(container).toBeVisible({ timeout: BOOT });
  // cytoscape stacks several canvases once it has drawn; waiting for those beats
  // a fixed sleep, which expires mid-render on a loaded machine.
  await expect
    .poll(
      async () =>
        container
          .locator('canvas')
          .evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width > 400).length),
      { timeout: BOOT }
    )
    .toBeGreaterThan(1);
  return container;
}

test.describe('Diagram behaviour', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('the diagram key is on screen', async ({ page }) => {
    await page.goto(PATHWAY);
    await drawnDiagram(page);

    const legend = page.locator('#legend-container');
    await expect(legend, 'the key curators check every release').toBeVisible();
    await expect(legend).toContainText(/LEGEND/i);

    // It is draggable, and the boundary it is dragged within has to exist or the
    // key ends up somewhere off screen.
    await expect(page.locator('#legend-boundary')).toBeAttached();
  });

  test('switching species to Mus musculus still draws a diagram', async ({ page }) => {
    await page.goto(PATHWAY);
    await drawnDiagram(page);

    // The toolbar control, not one of the sixteen entries inside the panel it
    // opens -- both carry the same class.
    await page.locator('.species').first().click();
    await page.locator('#species-container').getByText('Mus musculus').first().click();

    // The species label is the app's own confirmation that the switch took.
    await expect(page.locator('.species-content')).toContainText(/musculus|M\. musculus/i, {
      timeout: BOOT,
    });

    // And the diagram is redrawn rather than left blank: this is the check that
    // matters, because an inferred pathway that fails to draw still leaves the
    // label saying Mus musculus.
    await drawnDiagram(page);
    const painted = await page
      .locator('#cytoscape canvas')
      .first()
      .evaluate((canvas) => (canvas as HTMLCanvasElement).width > 0);
    expect(painted, 'a painted canvas for the inferred species').toBe(true);
  });

  // The bug the species test found: a diagram whose graph is missing one node
  // used to draw nothing at all, because the code logged "missing graph data"
  // and then dereferenced it anyway. Inferred species diagrams all have such
  // nodes, so every non-human diagram was blank. Two species, because one
  // passing could be luck with that species' data.
  for (const inferred of ['R-MMU-109606', 'R-RNO-109606']) {
    test(`the inferred diagram ${inferred} draws`, async ({ page }) => {
      await page.goto(`/PathwayBrowser/${inferred}?tab=info`);
      await drawnDiagram(page);
    });
  }
});
