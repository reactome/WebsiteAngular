import { test, expect } from '@playwright/test';

// Behaviours whose state does NOT arrive over HTTP.
//
// HttpClient registers a pending task per request and completing one schedules
// change detection, so plain "fetch then assign" keeps rendering even without
// zone.js. What silently stops updating is state set from something Angular has
// no visibility into: a raw window listener, a ResizeObserver, an
// IntersectionObserver, a bare setTimeout. Those are exactly the cases below,
// and each one is a real user-visible behaviour rather than a proxy for one.
//
// Set ZL=1 to run these against a zoneless bootstrap (see USE_ZONELESS in
// src/app/app.config.ts) -- that is how the zoneless migration is verified
// while zones are still the default for everyone else.
const ZQ = process.env.ZL === '1' ? '?zoneless=1' : '';
const LOAD = 45_000;

test('scroll-to-top button appears once the page is scrolled', async ({ page }) => {
  // Driven by a window scroll listener.
  await page.goto('/documentation/userguide/reactome-fiviz' + ZQ);
  await expect(page.locator('#Overview')).toHaveCount(1, { timeout: LOAD });

  const button = page.locator('.to-top');
  await expect(button).not.toHaveClass(/show-scrollTop/);
  await page.mouse.wheel(0, 3000);
  await expect(button).toHaveClass(/show-scrollTop/, { timeout: 10_000 });
});

test('download page highlights the section being read', async ({ page }) => {
  // Driven by an IntersectionObserver.
  await page.goto('/download-data' + ZQ);
  const tocLinks = page.locator('.toc a, nav a').filter({ hasText: /\w/ });
  await expect(tocLinks.first()).toBeVisible({ timeout: LOAD });

  await page.mouse.wheel(0, 4000);
  await expect(page.locator('.active').first()).toBeVisible({ timeout: 10_000 });
});

test('search suggestions close when the field loses focus', async ({ page }) => {
  // Closing is deferred through a setTimeout so a click on a suggestion still
  // registers; that timer is invisible to Angular.
  await page.goto('/' + ZQ);
  const input = page.locator('app-search-bar textarea, app-search-bar input').first();
  await input.waitFor({ state: 'visible', timeout: LOAD });

  await input.click();
  await input.fill('apop');
  const suggestions = page.locator('app-search-bar .suggestions, app-search-bar ul').first();
  await expect(suggestions).toBeVisible({ timeout: 20_000 });

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(suggestions).toBeHidden({ timeout: 10_000 });
});
