import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// Diagram behaviours from the release checklist that are not about a single
// pathway drawing: the key being on screen, and the species switch still drawing
// a diagram after it changes the pathway underneath.
//
// A sub-pathway is used deliberately: a top-level pathway renders an EHLD
// illustration rather than the interactive diagram.
/** The cytoscape instance the diagram hangs on the host element. */
interface CytoscapeHost extends HTMLElement {
  _cyreg?: { cy?: import('cytoscape').Core };
}

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
  /**
   * Navigating into a pathway box keeps what the reader had selected.
   *
   * It used to replace it with the pathway being left, to orient the reader in
   * the diagram they arrived in. A curator searched for an entity, double-clicked
   * a pathway box and found it unselected (#168) -- and the sibling handler for
   * `.SUB.Pathway` did not do this, so the two ways out of a diagram disagreed.
   *
   * Asserted on the address rather than on the handler, because `select` in the
   * URL is what survives a reload and what the reader can share.
   */
  test('keeps the selection when you open a pathway from inside the diagram', async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);

    await page.goto('/PathwayBrowser/R-HSA-70171?FLG=PKM', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT });
    await page.waitForTimeout(6000);

    // R-HSA-70171 has no diagram of its own, so the browser opens its parent and
    // selects it -- which is exactly the state a search leaves behind.
    const selected = new URL(page.url()).searchParams.get('select');
    expect(selected, 'something is selected to begin with').toBeTruthy();

    const target = await page.evaluate(() => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      const node = cy?.nodes('.Interacting.Pathway').first();
      return node && node.length ? (node.data('graph.stId') as string) : null;
    });
    if (!target) {
      test.skip(true, 'this diagram shows no pathway box to open');
      return;
    }

    await page.evaluate((stId) => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      cy?.nodes('.Interacting.Pathway')
        .filter((n) => n.data('graph.stId') === stId)
        .emit('dblclick');
    }, target);

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 60_000 }).toContain(target);

    const after = new URL(page.url());
    expect(after.searchParams.get('select'), 'the reader keeps what they selected').toBe(selected);
    expect(after.searchParams.get('flag'), 'and the flag they set').toBe('PKM');
  });

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
