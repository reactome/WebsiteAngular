import { test, expect } from './support/backend';

// Proposals of the second UI review (23 Nov 2026), approved by the project lead on 24 Nov.
const LOAD = 90_000;
const BROWSER_LOAD = 120_000;

test("the home page's guides and API links are cards that say where they go", async ({ page }) => {
  // They were 184px circles with a name each: a section a screen tall.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const help = page.locator('app-home-help .link-card');
  await expect(help.first()).toBeVisible({ timeout: LOAD });
  await expect(help).toHaveCount(6);
  await expect(page.locator('app-home-api-data .link-card')).toHaveCount(4);
  await expect(help.first().locator('.link-card-what')).not.toBeEmpty();
  const box = await page.locator('app-home-help').boundingBox();
  expect(box?.height ?? 1000).toBeLessThan(320);
});

test.describe('The table of contents', () => {
  const firstAuthors = (page: import('@playwright/test').Page) =>
    page.locator('tbody tr').filter({ hasText: 'Cell Cycle' }).first().locator('.col-authors');

  test('shows three names of a long list, and the rest on asking', async ({ page }) => {
    // Cell Cycle's people ran most of a screen.
    await page.goto('/content/toc');
    const authors = firstAuthors(page);
    await expect(authors.locator('.person-link').first()).toBeVisible({ timeout: LOAD });
    await expect(authors.locator('.person-link')).toHaveCount(3);
    const more = authors.getByRole('button', { name: /^\+ \d+ more$/ });
    const hidden = Number((await more.textContent())?.match(/\d+/)?.[0]);
    await more.click();
    await expect(authors.locator('.person-link')).toHaveCount(3 + hidden);
    await expect(more).toHaveCount(0);
  });

  test('shows every name while searching, so a name searched for is not hidden', async ({
    page,
  }) => {
    await page.goto('/content/toc');
    await expect(firstAuthors(page).locator('.person-link').first()).toBeVisible({ timeout: LOAD });
    await page.getByPlaceholder('Search pathways, species, people...').fill('Cell Cycle');
    await expect(firstAuthors(page).getByRole('button', { name: /more$/ })).toHaveCount(0);
    expect(await firstAuthors(page).locator('.person-link').count()).toBeGreaterThan(3);
  });
});

test('the icon library is a denser grid with no search button', async ({ page }) => {
  // 200px cards were mostly white space; the search already runs as you type.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/community/icon-lib');
  const card = page.locator('.icon-card').first();
  await expect(card).toBeVisible({ timeout: LOAD });
  expect((await card.boundingBox())?.width ?? 1000).toBeLessThan(180);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
});

test.describe('On a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Cite Us steps aside while scrolling down and returns on scrolling up', async ({ page }) => {
    // It sat over a line of every page.
    await page.goto('/content/detail/R-HSA-69488');
    const cite = page.getByRole('button', { name: 'Cite Us' });
    await expect(cite).toBeVisible({ timeout: LOAD });
    await expect(page.locator('.divider-name-container').first()).toBeVisible({ timeout: LOAD });
    await page.mouse.wheel(0, 600);
    await expect(cite).toHaveClass(/tucked/);
    await expect(cite).toHaveCSS('opacity', '0');
    await page.mouse.wheel(0, -200);
    await expect(cite).not.toHaveClass(/tucked/);
    await expect(cite).toHaveCSS('opacity', '1');
  });

  test("an entity's reference labels stand over their values, and gene names read as a list", async ({
    page,
  }) => {
    // In a column the width of "Overview", "External Reference" broke a word to a
    // line and ran into its values; gene names were "TP53,P53".
    await page.goto('/content/detail/R-HSA-69488');
    const row = page
      .locator('cr-external-reference .row')
      .filter({ has: page.locator('.label-container', { hasText: /^\s*Gene Names\s*$/ }) });
    await expect(row).toBeVisible({ timeout: LOAD });
    await expect(row.locator('.item')).toHaveText('TP53, P53');
    const [label, value] = await Promise.all([
      row.locator('.label-container').boundingBox(),
      row.locator('.composition-container').boundingBox(),
    ]);
    expect((label?.y ?? 0) + (label?.height ?? 0)).toBeLessThanOrEqual((value?.y ?? 0) + 1);
    const reference = page
      .locator('cr-external-reference .label-container', { hasText: 'External Reference' })
      .first();
    expect((await reference.boundingBox())?.height ?? 100).toBeLessThanOrEqual(22);
  });
});

test('the analysis examples start under their title, and say what they are for', async ({
  page,
}) => {
  // They sat at the foot of their column, an empty gap above them.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/PathwayBrowser?analysisTab=qualitative');
  const hint = page.locator('.example-hint');
  await expect(hint).toBeVisible({ timeout: BROWSER_LOAD });
  const first = page.getByRole('button', { name: 'UniProt IDs' });
  const [h, b] = await Promise.all([hint.boundingBox(), first.boundingBox()]);
  expect((b?.y ?? 1000) - ((h?.y ?? 0) + (h?.height ?? 0))).toBeLessThan(40);
  await expect(page.locator('.analysis-type-label .kind').first()).toHaveText('Qualitative');
});
