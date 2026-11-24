import { test, expect } from './support/backend';

// Proposals from the UI review of 23 November 2026, approved by the project lead.
const LOAD = 90_000;
const BROWSER_LOAD = 120_000;

test("a pathway's picture comes first, under its overview", async ({ page }) => {
  // It sat below the summary and the downloads, the last thing a reader reached.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/content/detail/R-HSA-109581');
  const figure = page.locator('.overview .overview-figure');
  await expect(figure).toBeVisible({ timeout: LOAD });
  const summary = page.locator('.summation .summation-text').first();
  await expect(summary).toBeVisible({ timeout: LOAD });
  const [f, s] = await Promise.all([figure.boundingBox(), summary.boundingBox()]);
  expect(f && s && f.y + f.height <= s.y).toBe(true);
});

test("a pathway with an illustration keeps it beside the overview, at the overview's height", async ({
  page,
}) => {
  // The icon was sized from the whole overview, which holds the icon: once the
  // diagram moved into the overview, each grew the other and the page without end.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/content/detail/R-HSA-109606');
  const illustration = page.locator('.overview > .icon-container.figure').first();
  await expect(illustration).toBeVisible({ timeout: LOAD });
  await expect(page.locator('.overview .overview-figure img')).toBeVisible({ timeout: LOAD });
  // Measured on the illustration, not the page, which grows as later sections arrive.
  const text = page.locator('.overview > cr-description-overview');
  const heights = async () => {
    const [i, t] = await Promise.all([illustration.boundingBox(), text.boundingBox()]);
    return {
      illustration: Math.round(i?.height ?? 0),
      text: Math.round(t?.height ?? 0),
      level: i?.y === t?.y,
    };
  };
  const first = await heights();
  await page.waitForTimeout(1500);
  const later = await heights();
  expect(later.illustration, 'the illustration keeps growing').toBe(first.illustration);
  expect(Math.abs(later.illustration - later.text)).toBeLessThanOrEqual(2);
  expect(later.level, 'beside the text, not under it').toBe(true);
});

test.describe('The Pathway Browser on a phone', () => {
  // The event tree took half the screen and cut every name short.
  test('opens on the diagram, the tree closed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/PathwayBrowser/R-HSA-109581');
    await expect(page.getByRole('button', { name: 'Layout' })).toBeVisible({
      timeout: BROWSER_LOAD,
    });
    await expect(page.locator('cr-event-hierarchy')).toBeHidden();
  });

  test('opens the tree from the Layout menu as a wide drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/PathwayBrowser/R-HSA-109581');
    await page.getByRole('button', { name: 'Layout' }).click({ timeout: BROWSER_LOAD });
    await page.getByRole('menuitemcheckbox', { name: /Hierarchy panel/ }).click();
    await page.keyboard.press('Escape');
    const tree = page.locator('cr-event-hierarchy');
    await expect(tree).toBeVisible({ timeout: LOAD });
    const box = await tree.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(300);
  });
});

test.describe('One page header', () => {
  // Thirteen pages each styled their own header, so the site opened differently page by page.
  for (const [path, section, title] of [
    ['/about/release-calendar', 'About', 'Release Calendar'],
    ['/content/toc', 'Content', 'Table of Contents'],
    ['/documentation/faq', 'Documentation', 'Frequently Asked Questions'],
    ['/download-data', 'Download', 'Download Data'],
  ] as const) {
    test(`${path} opens with its section and title`, async ({ page }) => {
      await page.goto(path);
      const header = page.locator('app-page-header');
      await expect(header.locator('h1')).toHaveText(title, { timeout: LOAD });
      await expect(header.locator('.section')).toHaveText(section);
    });
  }
});

test.describe('A pathway page on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/content/detail/R-HSA-109581');
  });

  // The word, centred in a column narrower than itself, lost its first letter.
  test('"Overview" is whole', async ({ page }) => {
    const word = page.locator('.divider-name .text', { hasText: 'Overview' }).first();
    await expect(word).toBeVisible({ timeout: LOAD });
    const container = page.locator('.divider-container').first();
    const [w, c] = await Promise.all([word.boundingBox(), container.boundingBox()]);
    expect(w && c && w.x >= c.x).toBe(true);
  });
});

// In the Pathway Browser's details panel on a phone, "Stable identifier" ran
// into its value: the pathway's own page stacked them, the panel did not.
test("the browser's details on a phone put each label over its value", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/PathwayBrowser/R-HSA-109581');
  const label = page
    .locator('cr-description-overview .label', { hasText: 'Stable identifier' })
    .first();
  await expect(label).toBeVisible({ timeout: BROWSER_LOAD });
  const value = label.locator('xpath=following-sibling::*[1]');
  const [l, v] = await Promise.all([label.boundingBox(), value.boundingBox()]);
  expect(l && v && l.y + l.height <= v.y + 1).toBe(true);
});
