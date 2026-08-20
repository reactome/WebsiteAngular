import { test, expect } from '@playwright/test';

// Searching inside a diagram, and across all of them.
//
// The release document asks for exactly this: "Search on USP10 in the DNA damage
// bypass diagram... Click the 'All Diagrams' tab in the In-Diagram search to view
// search results across all diagrams. The initial hits and the number of hits
// should differ between USP10 in Diagram vs USP10 in All Diagrams."
//
// It is also one of the four things the curators' QA pass found broken outright,
// and each of those blocked a whole section of their checklist from being
// testable. Something that has been broken once is worth a test.

const DNA_DAMAGE_BYPASS = 'R-HSA-73893';
const TERM = 'USP10';

/**
 * Type the term and actually run the search.
 *
 * Filling the box is not enough: the component searches on Enter or on the icon,
 * and Enter searches the current *suggestion*, which is not necessarily what was
 * typed. The icon searches what is in the box.
 */
async function search(page: import('@playwright/test').Page) {
  await page.locator('cr-search input').first().fill(TERM);
  await page.locator('cr-search .search-icon').first().click();
}

test.describe('In-diagram search', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  test('finds a protein in the current pathway, and more across all of them', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${DNA_DAMAGE_BYPASS}`);
    await page.waitForSelector('#cytoscape canvas', { timeout: 90_000 });

    await search(page);

    // Both scopes are shown at once, each with its own count, so there is no need
    // to switch tabs to compare them -- which is also what makes the comparison
    // meaningful rather than a race between two searches.
    const local = page.locator('cr-search .scope', { hasText: 'Current pathway' });
    const global = page.locator('cr-search .scope', { hasText: 'All pathways' });

    await expect(local).toBeVisible({ timeout: 60_000 });
    await expect(global).toBeVisible();

    const count = async (scope: typeof local) =>
      Number((await scope.locator('.count').innerText()).trim());

    const inThisPathway = await count(local);
    const everywhere = await count(global);

    expect(inThisPathway, `${TERM} hits in ${DNA_DAMAGE_BYPASS}`).toBeGreaterThan(0);
    // The document's point: a protein in one diagram is in others too, so the
    // wider search has to return more. Equal counts mean the scope is ignored.
    expect(everywhere, `${TERM} hits across all pathways`).toBeGreaterThan(inThisPathway);
  });

  test('selecting a result highlights it in the diagram', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${DNA_DAMAGE_BYPASS}`);
    await page.waitForSelector('#cytoscape canvas', { timeout: 90_000 });

    await search(page);
    const result = page.locator('cr-search .result-row').first();
    await expect(result).toBeVisible({ timeout: 60_000 });
    await result.click();

    // Selecting from the search puts the entity in the URL, which is what the
    // diagram, the details panel and a shared link all read.
    await expect(page).toHaveURL(/select=/, { timeout: 30_000 });
  });
});
