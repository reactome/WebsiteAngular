import { test, expect } from '@playwright/test';

// Behaviours whose state arrives from something Angular cannot observe.
//
// The app runs zoneless, so nothing patches the browser's async APIs. State set
// from a raw window listener, a ResizeObserver, an IntersectionObserver or a
// bare setTimeout reaches the template only if the component notifies Angular,
// and getting that wrong renders a stale view rather than throwing. Each test
// below asserts a real user-visible behaviour rather than a proxy for one, so a
// regression here means something a person would actually notice.
const LOAD = 45_000;

test('scroll-to-top button appears once the page is scrolled', async ({ page }) => {
  // Driven by a window scroll listener.
  await page.goto('/documentation/userguide/reactome-fiviz');
  await expect(page.locator('#Overview')).toHaveCount(1, { timeout: LOAD });

  const button = page.locator('.to-top');
  await expect(button).not.toHaveClass(/show-scrollTop/);
  await page.mouse.wheel(0, 3000);
  await expect(button).toHaveClass(/show-scrollTop/, { timeout: 10_000 });
});

test('download page highlights the section being read', async ({ page }) => {
  // Driven by an IntersectionObserver.
  await page.goto('/download-data');
  const tocLinks = page.locator('.toc a, nav a').filter({ hasText: /\w/ });
  await expect(tocLinks.first()).toBeVisible({ timeout: LOAD });

  await page.mouse.wheel(0, 4000);
  await expect(page.locator('.active').first()).toBeVisible({ timeout: 10_000 });
});

test('search suggestions close when the field loses focus', async ({ page }) => {
  // Closing is deferred through a setTimeout so a click on a suggestion still
  // registers; that timer is invisible to Angular.
  await page.goto('/');
  const input = page.locator('app-search-bar textarea, app-search-bar input').first();
  await input.waitFor({ state: 'visible', timeout: LOAD });

  await input.click();
  await input.fill('apop');
  const suggestions = page.locator('app-search-bar .suggestions, app-search-bar ul').first();
  await expect(suggestions).toBeVisible({ timeout: 20_000 });

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(suggestions).toBeHidden({ timeout: 10_000 });
});
