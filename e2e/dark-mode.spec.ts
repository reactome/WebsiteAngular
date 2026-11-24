import { type Locator, type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// Dark mode, page by page (24 Nov 2026): the home page's new link cards fell
// back to white under pale words, and the table of contents kept fixed colours,
// its pathway names near-black on the dark page.
const LOAD = 90_000;

async function goDark(page: Page) {
  await page.locator('#dark-toggle button').click();
  await expect(page.locator('body')).toHaveClass(/dark/);
}

/**
 * The WCAG contrast ratio of an element's text against the first solid
 * background behind it (its own or an ancestor's).
 */
function contrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
    };
    let back: number[] = [255, 255, 255];
    for (let e: Element | null = element; e; e = e.parentElement) {
      const parts = rgb(getComputedStyle(e).backgroundColor);
      if (parts.length >= 3 && (parts[3] ?? 1) >= 0.99) {
        back = parts;
        break;
      }
    }
    const [a, b] = [luminance(rgb(getComputedStyle(element).color)), luminance(back)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test("the home page's link cards are dark, and their words readable, in dark mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const card = page.locator('app-home-help .link-card').first();
  await expect(card).toBeVisible({ timeout: LOAD });
  await goDark(page);
  expect(await contrast(card.locator('.link-card-name'))).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(card.locator('.link-card-what'))).toBeGreaterThanOrEqual(4.5);
  const api = page.locator('app-home-api-data .link-card').first();
  expect(await contrast(api.locator('.link-card-what'))).toBeGreaterThanOrEqual(4.5);
});

test('the table of contents is readable in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/content/toc');
  const row = page.locator('.pathway-row').first();
  await expect(row.locator('.pathway-name')).toBeVisible({ timeout: LOAD });
  await goDark(page);
  for (const part of ['.pathway-name', '.species-name', '.person-link']) {
    expect(await contrast(row.locator(part).first()), part).toBeGreaterThanOrEqual(4.5);
  }
  expect(await contrast(page.locator('.status-chip.updated'))).toBeGreaterThanOrEqual(4.5);
});
