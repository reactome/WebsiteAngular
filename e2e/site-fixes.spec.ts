import { test, expect } from './support/backend';

// Site-wide fixes from the UI review of 23 November 2026.
const LOAD = 90_000;

test.describe("Each page's own title", () => {
  // Every page was titled "Reactome", so every tab, bookmark and search result read the same.
  test('the home page names the knowledgebase', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Reactome Pathway Knowledgebase', { timeout: LOAD });
  });

  test('a fixed page takes its route title', async ({ page }) => {
    await page.goto('/about/news');
    await expect(page).toHaveTitle('News · Reactome', { timeout: LOAD });
  });

  test("a pathway's page names it and its id", async ({ page }) => {
    await page.goto('/content/detail/R-HSA-109581');
    await expect(page).toHaveTitle('Apoptosis (R-HSA-109581) · Reactome', { timeout: LOAD });
  });

  test('a search names its query', async ({ page }) => {
    await page.goto('/content/query?q=TP53');
    await expect(page).toHaveTitle('TP53 · Search · Reactome', { timeout: LOAD });
  });

  test('the Pathway Browser names the pathway on show', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109581');
    await expect(page).toHaveTitle('Apoptosis · Pathway Browser · Reactome', { timeout: LOAD });
  });
});

test("a pathway's summary is one left-aligned column", async ({ page }) => {
  // Past 500 characters it went into two justified columns: gaps between the
  // words, and on a phone columns three or four words wide.
  await page.goto('/content/detail/R-HSA-109581');
  const summary = page.locator('.summation .summation-text').first();
  await expect(summary).toContainText('Apoptosis is a distinct form of cell death', {
    timeout: LOAD,
  });
  const style = await summary.evaluate((e) => {
    const c = getComputedStyle(e);
    const parent = getComputedStyle(e.parentElement as Element);
    return { columns: c.columnCount, align: parent.textAlign };
  });
  expect(style).toEqual({ columns: 'auto', align: 'start' });
});

test('Cite Us sits in the bottom-left corner, off the text', async ({ page }) => {
  // It was a tab on the left edge at half height, over every page's text.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/news');
  const cite = page.getByRole('button', { name: 'Cite Us' });
  await expect(cite).toBeVisible({ timeout: LOAD });
  const box = await cite.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeLessThanOrEqual(24);
  expect(844 - (box.y + box.height)).toBeLessThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test.describe("A pathway's diagram on its page", () => {
  // The frame stood empty for the seconds the diagram takes to draw, as if broken.
  test('says it is being drawn, then that it could not be', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/RenderService/render/**', async (route) => {
      await held;
      await route.abort();
    });
    await page.route('**/exporter/diagram/**', (route) => route.abort());
    await page.goto('/content/detail/R-HSA-109581');
    const frame = page.locator('.detail-diagram');
    await expect(frame).toContainText('Drawing the diagram…', { timeout: LOAD });
    release();
    await expect(frame).toContainText('The diagram could not be drawn', { timeout: LOAD });
  });
});
