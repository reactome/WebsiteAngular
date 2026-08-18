import { test, expect } from '@playwright/test';

// Smoke coverage for the Pathway Browser shell.
//
// Almost everything here depends on a live ContentService, so these tests double
// as a check that the backend wiring in environment.ts still resolves. When the
// dev server is the target, that means proxy.conf.json must route
// /ContentService -- otherwise the dev server answers with index.html and the
// tree silently renders empty.
//
// Note on assertions: several component host elements here (cr-viewport,
// cr-search) are `display: inline` and measure 0x0 because their content is
// absolutely positioned. They are real and mounted, but playwright's
// toBeVisible() treats a zero-area box as hidden -- so assert toBeAttached() on
// those, and save toBeVisible() for elements that actually occupy space
// (mat-tree, canvas, the toolbar buttons).

// The Pathway Browser boots a diagram renderer and several backend calls, so
// give it noticeably more room than a plain content page.
const BOOT_TIMEOUT = 45_000;

test.describe('Pathway Browser', () => {
  test('boots with the toolbar, search and viewport mounted', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    await expect(page.locator('cr-viewport')).toBeAttached({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('cr-search')).toBeAttached({ timeout: BOOT_TIMEOUT });
    await expect(page.getByRole('button', { name: /analyze/i })).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });
  });

  test('pathway tree is populated from the backend', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    const tree = page.locator('mat-tree');
    await expect(tree).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Top-level human pathways. If ContentService is unreachable the tree still
    // renders as an empty shell, so assert on real content rather than the
    // container existing.
    for (const pathway of ['Autophagy', 'Cell Cycle', 'Metabolism', 'Disease']) {
      await expect(tree.getByText(pathway, { exact: true }).first()).toBeVisible({
        timeout: BOOT_TIMEOUT,
      });
    }
  });

  test('renders a diagram canvas', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    // The diagram is drawn on canvas by ngx-reactome-diagram; a canvas with real
    // dimensions is the cheapest reliable signal that the renderer initialised.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('loads without uncaught page errors', async ({ page }) => {
    // Broad guard for the class of failure that is invisible in a screenshot:
    // a duplicate provideAnimations() once left every animation in the app
    // stuck, and a hung version lookup once blocked diagram downloads. Both
    // surfaced here first.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/PathwayBrowser?tab=info');
    await expect(page.locator('mat-tree')).toBeVisible({ timeout: BOOT_TIMEOUT });

    expect(pageErrors).toEqual([]);
  });
});

test.describe('Diagram search', () => {
  // Commented out wholesale in "Remove Overlay feature, feedback, and revert to
  // old site" (c4aca4d, May), which hid it from the public site as well as the
  // curator build it was aimed at. The component was never broken -- only its
  // markup was commented -- so this asserts the parts that would tell us if it
  // regressed again: suggestions, scopes and results.
  test('suggests terms and returns scoped results', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606');
    const input = page.locator('cr-search input').first();
    await expect(input).toBeVisible({ timeout: BOOT_TIMEOUT });

    await input.click();
    await input.fill('pten');
    await expect(page.locator('.suggest-line').first()).toBeVisible({ timeout: 20_000 });

    await input.press('Enter');
    const results = page.locator('cr-search .results');
    await expect(results).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Both scopes report counts: searching only the open diagram, and everything.
    await expect(results).toContainText(/Current pathway/i);
    await expect(results).toContainText(/All pathways/i);
  });
});

test('publication authors link to their person pages', async ({ page }) => {
  // These links were commented out, and for a reason: the markup referenced a
  // bare `environment` the component never had, so the hrefs came out as
  // "undefined/content/detail/person/...". They use the CONTENT_DETAIL constant
  // now, the same one object-tree uses for entity links.
  await page.goto('/PathwayBrowser/R-HSA-109606?tab=details');

  // Attached, not visible: publications sit in the References section further
  // down the panel, so the links are in the DOM without being on screen. What
  // matters is that they exist and point somewhere real.
  const authorLink = page.locator('cr-publication a[href*="/person/"]').first();
  await expect(authorLink).toBeAttached({ timeout: 25_000 });

  const href = await authorLink.getAttribute('href');
  expect(href, 'href must be absolute and host-aware, not "undefined/..."').toMatch(
    /^https?:\/\/[^/]+\/content\/detail\/person\/\d+$/
  );
  if (!href) throw new Error('no href to follow');

  // and it has to actually land on a person
  await page.goto(href);
  await expect(page.locator('app-person-detail')).toContainText(/Publications|Authored/, {
    timeout: 25_000,
  });
});
