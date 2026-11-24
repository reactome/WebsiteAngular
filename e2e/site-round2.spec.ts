import { test, expect } from './support/backend';

// Fixes from the second UI review of 23 November 2026, approved by the project lead.
const LOAD = 90_000;

test('the FAQ shows its questions as written, and its sections by their names', async ({
  page,
}) => {
  // Every word of the questions was capitalised: "Didn'T", "Api And R", "Reactome Gsa".
  await page.goto('/documentation/faq');
  const tabs = page.locator('.faq-tab');
  await expect(tabs.first()).toBeVisible({ timeout: LOAD });
  await expect(tabs).toHaveText(['API and R', 'ReactomeFIViz', 'General', 'ReactomeGSA']);
  await expect(
    page.locator('.faq-item a', { hasText: 'I searched for (...) and didn’t get any results.' })
  ).toHaveCount(1);
  await expect(page.locator('.category-name').first()).toHaveText('Analysis');
});

test('a page we do not have says so in its tab, and draws no empty menu', async ({ page }) => {
  await page.goto('/no-such-page-here');
  await expect(page.getByRole('heading', { name: "We can't find that page" })).toBeVisible({
    timeout: LOAD,
  });
  await expect(page).toHaveTitle('Page not found · Reactome');
  await expect(page.locator('app-sidebar aside')).toHaveCount(0);
});

test.describe("an entity's overview", () => {
  test('a long section heading keeps a line before it', async ({ page }) => {
    // "External Reference" squeezed its lines to a 4px stub, read as a stray dash.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/content/detail/R-HSA-69488');
    const heading = page.locator('#referenceEntity .divider-name .line').first();
    await expect(heading).toBeVisible({ timeout: LOAD });
    expect((await heading.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(15);
  });

  test('its synonyms are a list, not justified across a phone', async ({ page }) => {
    // Joined with bare commas and justified, they spread into gaps wider than the words.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/content/detail/R-HSA-69488');
    const synonyms = page
      .locator('.row', { has: page.locator('.label', { hasText: 'Synonyms' }) })
      .locator('.value');
    await expect(synonyms).toBeVisible({ timeout: LOAD });
    await expect(synonyms).toContainText('p53 protein, P53_HUMAN');
    expect(await synonyms.evaluate((e) => getComputedStyle(e).textAlign)).toBe('start');
  });
});

test('a search filter that scrolls shows that it does', async ({ page }) => {
  // The species list was cut through a row with nothing to say there was more.
  await page.goto('/content/query?q=TP53');
  const species = page.locator('.facet-options').first();
  await expect(species).toBeVisible({ timeout: LOAD });
  const style = await species.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      attachment: s.backgroundAttachment,
      image: s.backgroundImage,
      scrolls: e.scrollHeight > e.clientHeight,
    };
  });
  expect(style.scrolls, 'the list must be long enough to scroll for this to mean anything').toBe(
    true
  );
  expect(style.attachment).toContain('local');
  expect(style.image).toContain('radial-gradient');
});
