import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// The home page after outreach's notes (24 Nov 2026), approved by the project lead.
const LOAD = 90_000;

async function home(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('app-home-stats .stat-item').first()).toContainText(/\d/, {
    timeout: LOAD,
  });
  // The release's illustration loaded, so no test ends with it still in flight.
  await expect
    .poll(
      () =>
        page
          .locator('.home-hero-picture img')
          .evaluate(
            (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0
          ),
      { timeout: LOAD }
    )
    .toBe(true);
}

test('the search examples are what readers search for', async ({ page }) => {
  // TP53, Apoptosis and a Reactome id: a newcomer has no Reactome id yet.
  await home(page);
  await expect(page.locator('.home-hero-example')).toHaveText([
    'P04637',
    'BRCA1',
    'Signaling by EGFR',
    'glucose',
  ]);
});

test("the release's illustration is on white, as it was drawn", async ({ page }) => {
  // On the teal band its colours and labels read wrongly.
  await home(page);
  const picture = page.locator('.home-hero-picture');
  await expect(picture).toBeVisible({ timeout: LOAD });
  await expect(picture).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  // The image inside the panel, not over its edge.
  const panel = await picture.boundingBox();
  const image = await picture.locator('img').boundingBox();
  expect(image?.x ?? 0).toBeGreaterThan((panel?.x ?? 0) + 8);
  expect((image?.y ?? 0) + (image?.height ?? 0)).toBeLessThan(
    (panel?.y ?? 0) + (panel?.height ?? 0) - 8
  );
});

test("the release's numbers are a slim band under the tools", async ({ page }) => {
  // Not links, they outweighed the tools as a block of large icons above them.
  await home(page);
  const tools = await page.locator('.home-shortcut-tile').boundingBox();
  const stats = await page.locator('.home-stats-tile').boundingBox();
  expect(stats?.y ?? 0).toBeGreaterThan((tools?.y ?? 0) + (tools?.height ?? 0));
  expect(stats?.height ?? 1000).toBeLessThan(120);
  await expect(page.locator('app-home-stats .stat-header a')).toHaveText(/What's new/);
});

test('the research spotlight opens from anywhere on its card, its date as the news gives dates', async ({
  page,
}) => {
  await home(page);
  const spotlight = page.locator('app-home-spotlight');
  const date = spotlight.locator('.home-spotlight-date');
  await expect(date).toBeVisible({ timeout: LOAD });
  await expect(spotlight).not.toContainText('[');
  const newsDate = page.locator('.news-date').first();
  expect(await date.evaluate((e) => getComputedStyle(e).fontFamily)).toBe(
    await newsDate.evaluate((e) => getComputedStyle(e).fontFamily)
  );
  // A click on the card's heading, not its "Read more", opens the article: by
  // position, as a reader clicks (the card's link lies over the heading).
  await spotlight.scrollIntoViewIfNeeded();
  const title = await spotlight.locator('.home-spotlight-title').boundingBox();
  await page.mouse.click((title?.x ?? 0) + 20, (title?.y ?? 0) + (title?.height ?? 0) / 2);
  await expect(page).toHaveURL(/\/reactome-research-spotlight\/./);
});

test('every news entry has the same form', async ({ page }) => {
  // A release had a box and other news a small dot, out of line; the newest
  // headline was larger than the rest.
  await home(page);
  const markers = page.locator('.news-marker');
  await expect(markers.first()).toBeVisible({ timeout: LOAD });
  const boxes = await markers.evaluateAll((all) =>
    all.map((m) => {
      const r = m.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        text: m.textContent.trim(),
      };
    })
  );
  expect(new Set(boxes.map((b) => b.left)).size).toBe(1);
  expect(new Set(boxes.map((b) => b.width)).size).toBe(1);
  expect(boxes.every((b) => /^V\d+$/.test(b.text) || b.text === 'News')).toBe(true);
  expect(boxes.some((b) => b.text === 'News')).toBe(true);
  const sizes = await page
    .locator('.news-headline')
    .evaluateAll((all) => all.map((h) => getComputedStyle(h).fontSize));
  expect(new Set(sizes).size).toBe(1);
});

test('on a phone, Cite Us keeps clear of the top of a page', async ({ page }) => {
  // It sat over the caption of the release's illustration.
  await home(page, 390, 844);
  await expect(page.getByRole('button', { name: 'Cite Us' })).toHaveCSS('opacity', '0');
});
