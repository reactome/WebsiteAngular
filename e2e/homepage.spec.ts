import { test, expect } from '@playwright/test';

// Smoke coverage for the public homepage.
//
// Every section here is backed by either a content file or a live backend call,
// so "the page rendered all of its tiles" is a meaningful signal that nothing
// upstream broke.

// Each shortcut card and the route it must point at. Several of these have been
// silently mis-wired in the past (pointing at dead routes, or at the wrong
// analysis tab), which is invisible until someone clicks them.
const SHORTCUTS = [
  { name: 'Pathway Browser', href: '/PathwayBrowser' },
  { name: 'Analysis Tools', href: '/PathwayBrowser?analysisTab=qualitative' },
  { name: 'AI Chatbot', href: '/chat' },
  { name: 'ReactomeFIViz', href: '/documentation/userguide/reactome-fiviz' },
  { name: 'Documentation', href: '/documentation' },
];

test.describe('Homepage', () => {
  test('renders all of its sections', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Find Reactions, Proteins, and Pathways' })
    ).toBeVisible();
    await expect(page.locator('app-search-bar')).toBeVisible();

    // These come from separate components; if one throws during render, Angular
    // drops just that subtree and the rest of the page still looks fine.
    for (const heading of [
      'Reactome Research Spotlight',
      'Why Reactome?',
      'Latest News',
      'API and Data Access',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test('Analysis Tools carousel spans the full content width', async ({ page }) => {
    // Regression guard: curator's homepage and main's homepage both use the
    // class .home-shortcut-tile -- for a compact logo/warning box and for this
    // full-width carousel respectively. A curator-only `max-width: 1040px`
    // leaked onto main and squeezed the carousel, clipping the last card.
    // See the :host(.curator) scoping in home-page.component.scss.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');

    const tile = page.locator('.home-shortcut-tile');
    await expect(tile).toBeVisible();

    const box = await tile.boundingBox();
    expect(box).not.toBeNull();
    // Full width at this viewport is ~1368 (1400 less page padding); the
    // regression capped it at 1040.
    expect(box!.width).toBeGreaterThan(1200);
  });

  test('every shortcut card points at its real route', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');

    const shortcuts = page.locator('app-home-shortcuts');
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts.locator('a.shortcut-link')).toHaveCount(SHORTCUTS.length);

    for (const { name, href } of SHORTCUTS) {
      // mat-icon is aria-hidden, so the link's accessible name is just the label.
      await expect(shortcuts.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  test('Analysis Tools shortcut actually opens the analysis form', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');

    await page.locator('app-home-shortcuts').getByRole('link', { name: 'Analysis Tools' }).click();

    await expect(page).toHaveURL(/PathwayBrowser/);
    await expect(page).toHaveURL(/analysisTab=qualitative/);
    // The panel should genuinely open, not just put a param in the URL.
    await expect(page.getByText('Qualitative Entity Enrichment Analysis')).toBeVisible({
      timeout: 30_000,
    });
  });
});
