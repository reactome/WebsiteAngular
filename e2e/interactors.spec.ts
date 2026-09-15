// The interactor overlay.
//
// Pick a resource, interactors are drawn onto the diagram, and "Clear overlays"
// takes them away. Asserted by looking at the diagram, because a button turning
// blue proves only that a button turned blue.
//
// The confidence slider and the download, once recorded here as missing, are in
// `interactor-threshold.spec.ts`.
//
// This compared pictures of the diagram until 2026-09-15. It cannot any more:
// the count badge is not drawn below 0.6 zoom, where it is six screen pixels
// holding two digits, so at the zoom a pathway opens at the two pictures are
// identical and the test failed -- correctly. Zooming in first was not enough
// either, because the zoom keeps the current pan and the badges then sat outside
// the captured area; and fitting to them first passed here while still failing in
// CI, whose diagram is a different size and so opens somewhere else.
//
// A picture is the wrong instrument for this: it answers "does this viewport
// differ", and the question is "is the overlay on the diagram". So the count of
// badges cytoscape is actually drawing is what is asserted -- the same measure
// `interactor-threshold.spec.ts` uses, and one that does not depend on where the
// diagram happens to be panned. That the reader is *told* when they are too small
// to see is asserted there too, under "An overlay that cannot be seen yet".
import { test, expect, type Page } from '@playwright/test';

const PATHWAY = 'R-HSA-1368108'; // BMAL1:CLOCK,NPAS2 activates circadian gene expression

type CytoscapeHost = Element & {
  _cyreg?: {
    cy?: {
      zoom(level?: number): number;
      emit(event: string): void;
      nodes(selector?: string): {
        length: number;
        filter(fn: (node: { visible(): boolean }) => boolean): { length: number };
      };
    };
  };
};

/** Badges cytoscape is drawing right now, which is the overlay being present. */
async function drawnBadges(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    // Close enough in that a badge is worth drawing, so this measures the
    // overlay rather than the zoom the diagram happened to open at.
    if (cy.zoom() < 0.65) {
      cy.zoom(0.65);
      cy.emit('zoom');
    }
    const badges = cy.nodes('.InteractorOccurrences');
    return badges.filter((badge) => badge.visible()).length;
  });
}

test.describe('Interactor overlay', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('IntAct draws interactors onto the diagram, and clearing removes them', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`);
    await page.waitForSelector('#cytoscape canvas', { timeout: 90_000 });
    // Drawing continues after the first canvas appears.
    await page.waitForTimeout(4000);

    expect(await drawnBadges(page), 'nothing before a resource is chosen').toBe(0);

    await page.locator('.species-interactor-container .interactor').click();
    const panel = page.locator('cr-interactors');
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'IntAct' }).click();
    // The overlay is a fetch and a relayout.
    await expect
      .poll(() => drawnBadges(page), {
        message: 'IntAct drew interactors onto the diagram',
        timeout: 90_000,
      })
      .toBeGreaterThan(0);

    await panel.getByRole('button', { name: 'Clear overlays' }).click();
    await expect
      .poll(() => drawnBadges(page), {
        message: 'and clearing took them away again',
        timeout: 30_000,
      })
      .toBe(0);
  });
});
