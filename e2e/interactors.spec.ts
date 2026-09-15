import { test, expect } from '@playwright/test';

// The interactor overlay.
//
// Pick a resource, interactors are drawn onto the diagram, and "Clear overlays"
// takes them away. Asserted by looking at the diagram, because a button turning
// blue proves only that a button turned blue.
//
// The confidence slider and the download, once recorded here as missing, are in
// `interactor-threshold.spec.ts`.
//
// The zoom below is not incidental. The count badge is not drawn under 0.6,
// where it is six screen pixels holding two digits, so at the zoom a pathway
// opens at this comparison is between two identical pictures -- and it was,
// correctly, failing. That the reader is told about it instead is asserted in
// interactor-threshold.spec.ts ("An overlay that cannot be seen yet"); what is
// asserted here is that once the diagram can show them, it does.

interface Cytoscape {
  zoom(level?: number | { level: number; renderedPosition: { x: number; y: number } }): number;
  emit(event: string): void;
  width(): number;
  height(): number;
  collection(): Collection;
  nodes(selector?: string): Collection;
  fit(eles: Collection, padding?: number): void;
}
interface Collection {
  forEach(fn: (element: { data(key: string): Collection | undefined }) => void): void;
  union(other: Collection): Collection;
}

const PATHWAY = 'R-HSA-1368108'; // BMAL1:CLOCK,NPAS2 activates circadian gene expression

test.describe('Interactor overlay', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('IntAct draws interactors onto the diagram, and clearing removes them', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`);
    const diagram = page.locator('#cytoscape');
    await page.waitForSelector('#cytoscape canvas', { timeout: 90_000 });
    // Drawing continues after the first canvas appears; comparing against a
    // half-drawn diagram would show a difference that means nothing.
    await page.waitForTimeout(4000);

    await page.locator('.species-interactor-container .interactor').click();
    const panel = page.locator('cr-interactors');
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'IntAct' }).click();
    // The overlay is a fetch and a relayout.
    await page.waitForTimeout(9000);

    // Look where the badges are, and close enough in to draw them.
    //
    // Both halves are needed and neither is incidental. Below 0.6 zoom the badge
    // is not drawn at all -- six screen pixels holding two digits -- so the
    // comparison was between two identical pictures. Zooming alone did not fix
    // it either: the zoom keeps the current pan, and the badges sat outside the
    // visible area, so the pictures were identical again for a second reason.
    await page.evaluate(() => {
      const cy = (
        document.querySelector('#cytoscape') as (Element & { _cyreg?: { cy?: Cytoscape } }) | null
      )?._cyreg?.cy;
      if (!cy) throw new Error('no cytoscape instance on #cytoscape');
      // A collection, not an array. `fit` takes a collection and quietly does
      // nothing with an array -- which is how this looked like an app bug twice.
      let entities = cy.collection();
      cy.nodes('.InteractorOccurrences').forEach((badge) => {
        const entity = badge.data('entity');
        if (entity) entities = entities.union(entity);
      });
      cy.fit(entities, 60);
      // Fitting a scattered handful can land below the zoom that draws a badge,
      // so it is brought up about the centre the fit just chose.
      if (cy.zoom() < 0.65) {
        cy.zoom({ level: 0.65, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      }
      cy.emit('zoom');
    });
    await page.waitForTimeout(2000);

    const overlaid = await diagram.screenshot();

    // Cleared from the same viewpoint, so the only difference between the two
    // pictures is the overlay itself.
    await panel.getByRole('button', { name: 'Clear overlays' }).click();
    await page.waitForTimeout(5000);
    const cleared = await diagram.screenshot();

    expect(
      Buffer.compare(overlaid, cleared) !== 0,
      'the diagram showed the interactor overlay, and stopped showing it when cleared'
    ).toBe(true);
  });
});
