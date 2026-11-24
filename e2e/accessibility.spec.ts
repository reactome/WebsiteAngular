import { test, expect } from './support/backend';
import { contrast } from './support/contrast';

// From an accessibility check of beta (axe, WCAG 2 AA) on 24 Nov 2026:
// links and buttons with nothing to announce, images without alternative text,
// and words too faint to read.
const LOAD = 90_000;

test('the footer, breadcrumb and partner logos say what they are', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible({
    timeout: LOAD,
  });
  for (const site of ['X (Twitter)', 'Facebook', 'YouTube', 'Bluesky', 'GitHub', 'LinkedIn']) {
    await expect(page.getByRole('link', { name: `Reactome on ${site}` })).toHaveCount(1);
  }
  await page.goto('/');
  const logos = page.locator('.related-logo');
  await expect(logos.first()).toBeAttached({ timeout: LOAD });
  // Decorative: the words beside each logo say it.
  for (const logo of await logos.all()) await expect(logo).toHaveAttribute('alt', '');
});

test("a pathway's page names its icon buttons, links and review status", async ({ page }) => {
  await page.goto('/content/detail/R-HSA-109581');
  await expect(page.getByRole('button', { name: 'Expand all' }).first()).toBeVisible({
    timeout: LOAD,
  });
  for (const name of ['Collapse all', 'Collapse one', 'Expand one']) {
    await expect(page.getByRole('button', { name }).first()).toBeAttached();
  }
  await expect(page.getByRole('progressbar', { name: /^Review status: \d of 5$/ })).toBeAttached();
  await expect(page.getByRole('link', { name: /^Open origin of / }).first()).toBeAttached();
});

test('faint words are readable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/download-data');
  const description = page.locator('.dl-desc').first();
  await expect(description).toBeVisible({ timeout: LOAD });
  for (const part of ['.dl-desc', '.section-desc', '.toc-title']) {
    expect(await contrast(page.locator(part).first()), part).toBeGreaterThanOrEqual(4.5);
  }
  await page.goto('/');
  const date = page.locator('app-home-latest-news time').first();
  await expect(date).toBeVisible({ timeout: LOAD });
  expect(await contrast(date), 'a news date').toBeGreaterThanOrEqual(4.5);
  await page.goto('/content/detail/R-HSA-109581');
  const heading = page.locator('.divider-name .text').first();
  await expect(heading).toBeVisible({ timeout: LOAD });
  expect(await contrast(heading), 'a section heading').toBeGreaterThanOrEqual(4.5);
  const species = page.locator('.node-species').first();
  await expect(species).toBeVisible({ timeout: LOAD });
  expect(await contrast(species), "a location's species").toBeGreaterThanOrEqual(4.5);
  await page.goto('/community/icon-lib');
  const pages = page.locator('.page-info');
  await expect(pages).toBeVisible({ timeout: LOAD });
  expect(await contrast(pages), "the icon library's page count").toBeGreaterThanOrEqual(4.5);
});

test('a link in news text is underlined, not told apart by colour alone', async ({ page }) => {
  await page.goto('/about/news');
  const link = page.locator('.excerpt a').first();
  await expect(link).toBeVisible({ timeout: LOAD });
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
});
