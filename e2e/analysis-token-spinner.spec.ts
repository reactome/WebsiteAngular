import { test, expect } from './support/backend';

/**
 * The Analyze button spins while a result loads, and stops once it is shown.
 *
 * Whether it was shown was decided by comparing the result's token with the
 * one in the address. The service sends the token URL-encoded ("...%3D") and
 * the address holds it decoded ("...="), so for a result opened from a link
 * the two never matched and the button spun for as long as the page was open.
 */

// An existing result, read only: nothing is submitted. It ends in "=".
const TOKEN = 'MjAyNjA5MjUxNDM3NThfMTM=';
const LOAD = 60_000;

test('the Analyze button stops spinning once a linked result is shown', async ({ page }) => {
  await page.goto(`/PathwayBrowser/R-HSA-69620?analysis=${encodeURIComponent(TOKEN)}`);
  // Shown: the diagram is coloured by it.
  await expect
    .poll(
      () =>
        page.evaluate<number>(`(() => {
          const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
          return cy ? cy.nodes().filter((n) => n.data('exp') !== undefined).length : 0;
        })()`),
      { timeout: LOAD }
    )
    .toBeGreaterThan(0);
  const analyze = page.getByRole('button', { name: /Analyze/ });
  await expect(analyze).not.toHaveClass(/\bloading\b/, { timeout: 5000 });
  await expect(analyze.locator('mat-spinner')).toHaveCount(0);
});
