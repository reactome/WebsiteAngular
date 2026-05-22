import { test, expect, Page } from '@playwright/test';

// Smoke test for the TinaCMS admin shell at /admin/index.html.
//
// Catches the two regressions we hit during the 3.4 -> 3.8 upgrade:
//
//   1. @tinacms/cli@2.1.8+ init hang -- if `tinacms dev` never reaches
//      its "Dev Server is active" state, `ng serve` is never spawned and
//      the page never loads at all (connection refused on :4200).
//
//   2. `tinacms dev` binds only to ::1:4001 -- the admin's hardcoded
//      `http://localhost:4001/...` script tags can't resolve via the
//      IPv4-only docker port-publish. Tina then renders its built-in
//      "Failed loading TinaCMS assets" placeholder. The IPv4 forwarder
//      at projects/website-angular/src/scripts/tina-ipv4-proxy.js must
//      be running for the assets to load.
//
// Note on the "Enter Edit Mode" modal: a fresh playwright context has
// no Tina session cookie, so Tina shows a one-time modal before exposing
// the sidebar/collections. A real human only sees this once.
async function dismissEditModeModal(page: Page) {
  // Wait for the modal to actually render (networkidle fires before Tina's
  // React app mounts it). Short timeout because if no modal appears, we
  // were already past it.
  const enterEdit = page.getByRole('button', { name: /enter edit mode/i });
  try {
    await enterEdit.waitFor({ state: 'visible', timeout: 5000 });
    await enterEdit.click();
    await page.waitForTimeout(1500);
  } catch {
    // No modal -- already in edit mode.
  }
}

async function enterAdmin(page: Page) {
  await page.goto('/admin/index.html', { waitUntil: 'networkidle' });
  await dismissEditModeModal(page);
}

test.describe('TinaCMS admin shell', () => {
  test('loads without the "Failed loading assets" placeholder', async ({ page }) => {
    await page.goto('/admin/index.html', { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/TinaCMS/i);
    await expect(page.locator('#no-assets-placeholder')).toHaveCount(0);
    await expect(page.locator('text=Failed loading TinaCMS assets')).toHaveCount(0);
  });

  test('every collection in tina/config.ts is reachable by URL', async ({ page }) => {
    // Driving Tina's collapsible sidebar via the hamburger is fragile (the
    // hamburger is layered behind the llama logo SVG which intercepts
    // pointer events). Hitting each collection's hash URL exercises the
    // same code path -- if Tina rejects the URL the page header label
    // doesn't render. This catches schema regressions (collection
    // removed, renamed, or broken by a config change).
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterAdmin(page);

    for (const { name, label } of [
      { name: 'about', label: 'About' },
      { name: 'news', label: 'News' },
      { name: 'content', label: 'Content' },
      { name: 'reactome_research_spotlights', label: 'Reactome Research Spotlights' },
      { name: 'documentation', label: 'Documentation' },
      { name: 'community', label: 'Community' },
    ]) {
      await page.evaluate((n) => {
        window.location.hash = `#/collections/${n}`;
      }, name);
      await page.waitForTimeout(1500);
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test('clicking a row title opens the form-only admin editor, not visual edit', async ({
    page,
  }) => {
    // Tina's collection table needs horizontal room. The default 1280x720
    // viewport renders the table in a layout where rows don't materialize
    // until enough columns fit.
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterAdmin(page);

    // News is the worst case for visual editing: long filenames hide the
    // kebab "Edit in Admin" action off-screen. With `ui.router` removed
    // (commit 4f2c9c8 prior), the title click instead routes to the
    // form-only admin editor. Re-adding ui.router would re-introduce the
    // visual-edit iframe trap and this assertion would fail.
    // Don't `page.goto` to a new URL -- it triggers a full reload that
    // re-renders the edit-mode modal even after we dismissed it in
    // enterAdmin. Mutating location.hash keeps Tina's React app mounted
    // and just routes within it.
    await page.evaluate(() => {
      window.location.hash = '#/collections/news';
    });
    await page.waitForTimeout(2500);
    const firstRowLink = page.locator('tbody tr a').first();
    await expect(firstRowLink).toBeVisible({ timeout: 15000 });
    await firstRowLink.click();

    await expect(page).toHaveURL(/\/admin\/index\.html#\/collections\/edit\/news\//, {
      timeout: 10000,
    });
  });
});
