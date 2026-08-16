import { test, expect, Page } from '@playwright/test';

// Right-click menu on diagram entities (issue #122).
//
// The old site offered Molecule / Pathways / Interactors here and curators
// still reach for it. Each item is a shortcut into the details panel, so the
// assertions are on where you end up, not on the menu's own markup.
//
// A sub-pathway is used deliberately: top-level pathways such as Apoptosis
// render an EHLD illustration rather than the interactive diagram, and have no
// entities to right-click at all.
const PATHWAY = '/PathwayBrowser/R-HSA-109606?tab=info';
const BOOT = 60_000;

/**
 * Entities are drawn on a canvas, so there is no element to target. Sweep the
 * diagram until a right-click lands on one. The sweep is bounded and fails
 * loudly rather than silently passing if nothing is ever hit.
 */
async function openMenuOnAnyEntity(page: Page): Promise<string> {
  const container = page.locator('#cytoscape').first();
  await expect(container).toBeVisible({ timeout: BOOT });

  // cytoscape draws onto several stacked canvases once it has laid the diagram
  // out. Waiting for those is far more reliable than a fixed sleep, which on a
  // loaded machine expires while the diagram is still empty.
  await expect
    .poll(
      async () =>
        container.locator('canvas').evaluateAll((els) =>
          els.filter((el) => el.getBoundingClientRect().width > 400).length,
        ),
      { timeout: BOOT },
    )
    .toBeGreaterThan(1);

  const menu = page.locator('.context-menu');

  // Two passes, offset from each other, so a diagram that was still settling on
  // the first sweep gets a second chance before the test is called a failure.
  for (const offset of [0, 0.017]) {
    await page.waitForTimeout(3_000);
    const box = (await container.boundingBox())!;

    for (let fy = 0.12 + offset; fy <= 0.92; fy += 0.04) {
      for (let fx = 0.08 + offset; fx <= 0.94; fx += 0.035) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, {
          button: 'right',
        });
        if (await menu.count()) {
          return (await page.locator('.context-menu__heading').innerText()).trim();
        }
      }
    }
  }
  throw new Error('no diagram entity found to right-click');
}

test.describe('Diagram right-click menu', () => {
  test.slow();

  test('offers Molecule, Pathways and Interactors for an entity', async ({ page }) => {
    await page.goto(PATHWAY);
    const entity = await openMenuOnAnyEntity(page);

    // The heading names the entity the menu will act on.
    expect(entity.length).toBeGreaterThan(0);
    await expect(page.getByRole('menuitem')).toHaveText([
      'Molecule',
      'Pathways',
      'Interactors',
    ]);
  });

  test('closes on Escape without navigating', async ({ page }) => {
    await page.goto(PATHWAY);
    await openMenuOnAnyEntity(page);
    const before = page.url();

    await page.keyboard.press('Escape');

    await expect(page.locator('.context-menu')).toHaveCount(0);
    expect(page.url()).toBe(before);
  });

  for (const { item, expected } of [
    { item: 'Molecule', expected: /[?&]tab=molecule/ },
    { item: 'Pathways', expected: /[?&]tab=details.*#locationsInPWB/ },
    { item: 'Interactors', expected: /[?&]tab=details.*#interactors/ },
  ]) {
    test(`"${item}" selects the entity and opens its section`, async ({ page }) => {
      await page.goto(PATHWAY);
      await openMenuOnAnyEntity(page);

      await page.getByRole('menuitem', { name: item, exact: true }).click();

      // Selecting the entity is what makes the panel show it at all, so both
      // halves matter: the selection, and the destination within the panel.
      await expect(page).toHaveURL(/[?&]select=R-[A-Z]+-\d+/, { timeout: 15_000 });
      await expect(page).toHaveURL(expected, { timeout: 15_000 });
      await expect(page.locator('.context-menu')).toHaveCount(0);
    });
  }
});
