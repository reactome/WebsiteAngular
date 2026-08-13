import { test, expect } from '@playwright/test';

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

    await expect(page.getByText('Qualitative Entity Enrichment Analysis')).toBeVisible({ timeout: BOOT_TIMEOUT });
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
    await expect(page.locator('reactome-table').getByText('A2M', { exact: true }).first()).toBeVisible();
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

    await expect(page.getByText('Step 1: Select one of the available analysis methods')).toBeVisible({
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
    await page.goto('/PathwayBrowser?analysisTab=quantitative');

    const methods = page.locator('gsa-method');
    await expect(methods.first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    await methods.first().click();

    // Continue is the round fab; it only enables once a method is selected,
    // which is driven by the NgRx method feature state.
    const continueBtn = page.locator('button.mat-mdc-fab').first();
    await expect(continueBtn).toBeEnabled({ timeout: 20_000 });
    await continueBtn.click();

    await expect(page.getByText('Step 2: Add and annotate your datasets')).toBeVisible({ timeout: 20_000 });
    // Dataset sources are a second backend-backed NgRx feature.
    await expect(page.getByText('Example Dataset')).toBeVisible({ timeout: 20_000 });
  });
});
