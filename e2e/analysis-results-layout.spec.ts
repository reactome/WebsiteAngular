import { test, expect } from './support/backend';

// Analysis results in the Pathway Browser (review of 24 Nov 2026, approved by
// the project lead): room for the results, pathway names whole, and the
// analysis's own downloads first. A 20-gene analysis made on beta for these.
const TOKEN = 'MjAyNjExMjQwMzQzMDRfMTM%3D';
const PATHWAY = 'R-HSA-3700989';
const LOAD = 120_000;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/PathwayBrowser/${PATHWAY}?analysis=${TOKEN}`);
  await expect(page.getByRole('tab', { name: /Results/ }).first()).toBeVisible({ timeout: LOAD });
});

test("an analysis's results open the details panel to nearly half the height", async ({ page }) => {
  // At a fifth, the table showed its header and one row. It also needs the
  // split's transition to end: at 1500s, a size set in code never arrived.
  const panel = page.locator('#bottom-panel');
  await expect
    .poll(async () => (await panel.boundingBox())?.height ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(300);
});

test('a pathway name in the results is shown whole', async ({ page }) => {
  await page
    .getByRole('tab', { name: /Results/ })
    .first()
    .click();
  const name = page
    .locator('.pathway-name')
    .filter({ hasText: 'Transcriptional Regulation by TP53' })
    .first();
  await expect(name).toBeVisible({ timeout: LOAD });
  const clipped = await name.evaluate(
    (e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1
  );
  expect(clipped, 'the name is cut').toBe(false);
});

test("the download tab puts the analysis's files first", async ({ page }) => {
  await page
    .getByRole('tab', { name: /Download/ })
    .first()
    .click();
  const first = page.locator('cr-download-tab h3.category').first();
  await expect(first).toHaveText('Analysis Results', { timeout: LOAD });
});
