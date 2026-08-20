import { test, expect } from '@playwright/test';

// The interactor overlay.
//
// The release document asks for three things here. Two of them do not exist in
// this UI -- there is no confidence slider and no interactor download, and no
// threshold concept anywhere in the interactor services -- so they are recorded
// as missing features in RELEASE-TESTING.md rather than pretended at here.
//
// What does exist is the overlay itself: pick a resource, interactors are drawn
// onto the diagram, and "Clear overlays" takes them away. That is asserted by
// looking at the diagram, because a button turning blue proves only that a button
// turned blue.

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

    const before = await diagram.screenshot();

    await page.locator('.species-interactor-container .interactor').click();
    const panel = page.locator('cr-interactors');
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'IntAct' }).click();
    // The overlay is a fetch and a relayout.
    await page.waitForTimeout(9000);
    const overlaid = await diagram.screenshot();

    expect(
      Buffer.compare(before, overlaid) !== 0,
      'the diagram changed when interactors were overlaid'
    ).toBe(true);

    await panel.getByRole('button', { name: 'Clear overlays' }).click();
    await page.waitForTimeout(5000);
    const cleared = await diagram.screenshot();

    expect(
      Buffer.compare(overlaid, cleared) !== 0,
      'the diagram changed again when the overlay was cleared'
    ).toBe(true);
  });
});
