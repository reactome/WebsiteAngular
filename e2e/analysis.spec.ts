import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// GSAServer is a shared production service, and this suite runs often. Exactly
// one test below calls it for real -- that is the integration check worth
// having, since an empty methods list makes the wizard a dead end. Every other
// test that merely needs the wizard on screen replays a captured response, so a
// full run costs one request rather than three.
const gsaMethods = JSON.parse(
  // __dirname, not import.meta.url: this package is CommonJS, and import.meta
  // makes Playwright's loader treat the spec as ESM and fail to load it at all.
  readFileSync(join(__dirname, 'fixtures', 'gsa-methods.json'), 'utf8')
);

async function stubGsaMethods(page: Page) {
  await page.route('**/GSAServer/**/methods', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(gsaMethods) })
  );
}

// Smoke coverage for the two analysis entry points, which are the public face of
// the two libraries absorbed from reactome/gsa-frontend into projects/:
//
//   qualitative  -> reactome-table      (the editable data grid)
//   quantitative -> reactome-gsa-form   (the ReactomeGSA wizard, NgRx-backed)
//
// Those libraries used to arrive as versioned npm packages and now build from
// source in this repo, so these tests are the regression net for that change --
// and for the Angular upgrade, where their NgRx and Material peer deps have to
// move in lockstep with the rest of the workspace.
//
// The quantitative form additionally needs /GSAServer to be reachable; against a
// dev server that requires the proxy.conf.json entry.

const BOOT_TIMEOUT = 45_000;

test.describe('Qualitative analysis (reactome-table)', () => {
  test('renders the wizard and the data grid', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=qualitative');

    await expect(page.getByText('Qualitative Entity Enrichment Analysis')).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });
    await expect(page.locator('reactome-table')).toBeVisible({ timeout: BOOT_TIMEOUT });
  });

  test('loading example data fills the grid and enables the next step', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=qualitative');
    await expect(page.locator('reactome-table')).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Next is gated on the table's own hasData$ observable, so this exercises
    // reactome-table's internal ComponentStore, not just its rendering.
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeDisabled();

    await page.getByRole('button', { name: 'Gene Name', exact: true }).click();

    await expect(next).toBeEnabled({ timeout: 20_000 });
    // The fetched example is a gene-name list; A2M is its first row.
    await expect(
      page.locator('reactome-table').getByText('A2M', { exact: true }).first()
    ).toBeVisible();
  });

  test('advances to the options step', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=qualitative');
    await expect(page.locator('reactome-table')).toBeVisible({ timeout: BOOT_TIMEOUT });

    await page.getByRole('button', { name: 'Gene Name', exact: true }).click();
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.click();

    await expect(page.getByText('Project to Human')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Include Interactors')).toBeVisible();
  });
});

test.describe('Quantitative analysis (reactome-gsa-form)', () => {
  test('loads the analysis methods from GSAServer', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=quantitative');

    await expect(
      page.getByText('Step 1: Select one of the available analysis methods')
    ).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });

    // Methods arrive via an NgRx effect hitting /GSAServer/0.1/methods. If that
    // call fails the accordion renders empty and the wizard is a dead end, so
    // assert on the cards themselves.
    const methods = page.locator('gsa-method');
    await expect(methods.first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    expect(await methods.count()).toBeGreaterThan(0);
  });

  test('selecting a method advances to dataset selection', async ({ page }) => {
    // Replayed, not live: the test above already proves the real call works.
    await stubGsaMethods(page);
    await page.goto('/PathwayBrowser?analysisTab=quantitative');

    const methods = page.locator('gsa-method');
    await expect(methods.first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    await methods.first().click();

    // Continue is the round fab; it only enables once a method is selected,
    // which is driven by the NgRx method feature state.
    const continueBtn = page.locator('button.mat-mdc-fab').first();
    await expect(continueBtn).toBeEnabled({ timeout: 20_000 });
    await continueBtn.click();

    await expect(page.getByText('Step 2: Add and annotate your datasets')).toBeVisible({
      timeout: 20_000,
    });
    // Dataset sources are a second backend-backed NgRx feature.
    await expect(page.getByText('Example Dataset')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Names readable on a laptop screen', () => {
  // At 1366x768 the example column split into two and every button read
  // "UniP…", "Gen…"; half the species tiles read "C. elega…". Each name is
  // checked for being cut on either axis and for staying inside its control.
  const cut = (selector: string, within: string) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
      const box = el.getBoundingClientRect();
      const host = el.closest(${JSON.stringify(within)}).getBoundingClientRect();
      return (
        el.scrollWidth > el.clientWidth + 1 ||
        el.scrollHeight > el.clientHeight + 1 ||
        box.left < host.left - 1 || box.right > host.right + 1 ||
        box.top < host.top - 1 || box.bottom > host.bottom + 1
      );
    }).map((el) => el.textContent.trim())`;

  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    test(`example buttons and species at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/PathwayBrowser?analysisTab=qualitative');
      await expect(page.getByRole('button', { name: 'Gene Name' })).toBeVisible({
        timeout: 120_000,
      });
      await page.waitForTimeout(1000);
      expect
        .soft(await page.evaluate(cut('.example-buttons .mdc-button__label', 'button')))
        .toEqual([]);

      await page.goto('/PathwayBrowser?analysisTab=species');
      await expect(page.locator('.species-name').first()).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(1000);
      expect(
        await page.evaluate(cut('.species-selector-grid .species-name', '.species-button'))
      ).toEqual([]);
    });
  }
});

test.describe('Analysis options without a mouse', () => {
  // The two option cards were divs with a click handler: no keyboard could
  // reach them, and a screen reader heard two paragraphs, not two choices.
  test('each option is a checkbox that Space toggles', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=qualitative');
    await page.getByRole('button', { name: 'Gene Name' }).click({ timeout: 120_000 });
    await page.getByRole('button', { name: /^Next$/ }).click();

    const interactors = page.getByRole('checkbox', { name: 'Include Interactors' });
    const human = page.getByRole('checkbox', { name: 'Project to Human' });
    await expect(human).toBeVisible();
    const before = (await interactors.getAttribute('aria-checked')) ?? '';

    await interactors.focus();
    await page.keyboard.press('Space');
    await expect(interactors).not.toHaveAttribute('aria-checked', before);
    await page.keyboard.press('Enter');
    await expect(interactors).toHaveAttribute('aria-checked', before);
  });
});
