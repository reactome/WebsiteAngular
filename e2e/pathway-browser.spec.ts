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
    await expect(page.getByRole('button', { name: /analyze/i })).toBeVisible({ timeout: BOOT_TIMEOUT });
  });

  test('pathway tree is populated from the backend', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    const tree = page.locator('mat-tree');
    await expect(tree).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Top-level human pathways. If ContentService is unreachable the tree still
    // renders as an empty shell, so assert on real content rather than the
    // container existing.
    for (const pathway of ['Autophagy', 'Cell Cycle', 'Metabolism', 'Disease']) {
      await expect(tree.getByText(pathway, { exact: true }).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
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
