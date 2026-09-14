import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';

// What an analysis is *for*: the numbers beside the pathways, the table you sort
// and filter, and the files you take away. The existing analysis spec drives the
// wizards up to the last step and stops, so everything after "Analyse" was
// unverified -- including the two overlays that have no wizard of their own.
//
// One analysis is created per test rather than shared: a token is server-side
// state, and a test that depends on another test's token fails in isolation and
// passes in a suite, which is the worst way round.

const READY = 120_000;

/** A hierarchy badge: "12 / 117" beside a pathway name. */
const BADGE = '.tree-node .analysis';

/** Run the gene-list analysis over the built-in gene-name example. */
async function runGeneList(page: Page) {
  await page.goto('/PathwayBrowser?analysisTab=qualitative');
  await page.getByRole('button', { name: 'Gene Name' }).click({ timeout: READY });
  // Options, then Analysis: the wizard's own two steps.
  for (const wait of [2000, 0]) {
    await page.getByRole('button', { name: /^Next$/ }).click();
    if (wait) await page.waitForTimeout(wait);
  }
  await expect(page).toHaveURL(/[?&]analysis=/, { timeout: READY });
  await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
}

async function openTab(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click();
}

test.describe('Analysis results', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  test('hit counts sit beside pathway names, and the table carries FDR', async ({ page }) => {
    await runGeneList(page);

    // Every badge is "found / total", and found is never more than total.
    const badges = await page.locator(BADGE).allInnerTexts();
    expect(badges.length, 'pathways with a hit count').toBeGreaterThan(5);
    for (const badge of badges.slice(0, 10)) {
      const [found, total] = badge.split('/').map((part) => Number(part.trim()));
      expect(Number.isFinite(found) && Number.isFinite(total), `badge "${badge}"`).toBe(true);
      expect(found, `badge "${badge}"`).toBeLessThanOrEqual(total);
    }

    await openTab(page, 'Results');
    await expect(page.getByRole('columnheader', { name: /Entities FDR/i })).toBeVisible({
      timeout: 60_000,
    });
    // A column of numbers, not a column of blanks.
    const fdr = await page.locator('td:has(cr-expression-tag)').first().innerText();
    expect(fdr.trim(), 'an FDR value').toMatch(/\d/);
  });

  test('a filter changes the result set', async ({ page }) => {
    await runGeneList(page);
    await openTab(page, 'Results');

    const rows = page.locator('cr-result-tab table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const before = await rows.count();
    expect(before, 'pathways before filtering').toBeGreaterThan(20);

    // The FDR slider rather than the Diseases toggle or a species facet: the
    // toggle changes a total the page does not show, and the species facet is
    // disabled for a human gene list because there is nothing to choose between.
    await page.locator('cr-result-tab button:has(mat-icon:text("filter_alt"))').first().click();
    const fdr = page.locator('.mat-mdc-menu-panel input[type="range"]').first();
    await fdr.focus();
    // Arrow keys, because a mat-slider thumb is not filled like an input.
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
    }
    expect(await fdr.inputValue(), 'the strictest FDR').toBe('0');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    const after = await rows.count();
    expect(after, 'a stricter FDR keeps fewer pathways').toBeLessThan(before);
    expect(after, 'but not none of them').toBeGreaterThan(0);
  });

  test('the result files download', async ({ page }) => {
    await runGeneList(page);
    await openTab(page, 'Download');

    for (const [label, looksRight] of [
      ['CSV Result', (bytes: Buffer) => bytes.toString('utf8', 0, 200).includes(',')],
      // Served gzipped, so check the gzip magic rather than the JSON.
      ['JSON Result', (bytes: Buffer) => bytes[0] === 0x1f && bytes[1] === 0x8b],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.getByText(label, { exact: true }).click(),
      ]);
      const bytes = readFileSync(await (download as Download).path());
      expect(bytes.length, `${label} size`).toBeGreaterThan(100);
      expect(looksRight(bytes), `${label} content`).toBe(true);
    }
  });

  test('species comparison overlays the pathways', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=species');
    await page.getByText('M. musculus').first().click({ timeout: READY });
    await page.getByRole('button', { name: /^Next$/ }).click();

    await expect(page).toHaveURL(/[?&]analysis=/, { timeout: READY });
    await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
    expect((await page.locator(BADGE).count()) > 5, 'pathways carrying a comparison').toBe(true);
  });

  test('tissue distribution overlays the pathways', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=tissue');
    await page.getByText('Colon', { exact: true }).click({ timeout: READY });
    // The chevron between the two lists moves the selection across.
    await page
      .locator('.arrow, [class*="forward"], mat-icon')
      .filter({ hasText: /double_arrow|fast_forward/ })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => {});
    await page.getByRole('button', { name: /^Next$/ }).click();

    await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
  });
});
