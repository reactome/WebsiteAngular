import { test, expect } from './support/backend';

/**
 * The diagram's controls are on screen before the diagram is: the zoom slider,
 * the navigation wheel and the keyboard all answer while it is still loading.
 * Pressing one then must do nothing, rather than throw because there is no
 * graph yet to zoom or pan (#344).
 */

const PATHWAY = 'R-HSA-69620';
const LOAD = 60_000;

test('the zoom and pan controls do nothing before the diagram has loaded', async ({ page }) => {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));

  // Hold the diagram back until the controls have been pressed.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/diagram\/R-HSA-69620\.json(\?|$)/, async (route) => {
    await held;
    // fallback(), not continue(): continue() goes straight to the network,
    // past the fixture's saved copy of the file.
    await route.fallback();
  });

  await page.goto(`/PathwayBrowser/${PATHWAY}`);
  const diagram = page.locator('cr-diagram');
  await expect(diagram.locator('#nav-wheel #fit')).toBeVisible({ timeout: LOAD });

  for (const control of ['#fit', '#up', '#right', '#down', '#left']) {
    await diagram.locator(`#nav-wheel ${control}`).click();
  }
  await diagram.locator('#cytoscape').focus();
  for (const key of ['+', '-', 'ArrowUp', 'ArrowLeft']) await page.keyboard.press(key);

  release();
  await expect
    .poll(
      () =>
        page.evaluate<number>(`(() => {
          const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
          return cy ? cy.nodes().length : 0;
        })()`),
      { timeout: LOAD }
    )
    .toBeGreaterThan(0);
  expect(thrown).toEqual([]);
});
