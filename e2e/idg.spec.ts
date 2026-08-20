import { test, expect } from '@playwright/test';

// The IDG page reads its data from idg.reactome.org, which is a different server
// from everything else this suite exercises. These checks deliberately stop short
// of the results table: a test that needs that service to answer would fail here
// whenever it is down, which says nothing about our build. What is guarded is the
// part we own -- the route exists, the page renders, and searching puts the gene
// in the URL so a result can be shared.
test.describe('IDG', () => {
  test('the page renders and takes a gene', async ({ page }) => {
    await page.goto('/idg');

    await expect(
      page.getByRole('heading', { name: 'Illuminating the Druggable Genome' })
    ).toBeVisible();

    const gene = page.locator('input[name="gene"]');
    await expect(gene).toBeVisible();

    // Lower case on purpose: the IDG index holds upper-case symbols only, so the
    // page upper-cases what it is given. Typing "tanc1" used to find nothing.
    await gene.fill('tanc1');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page).toHaveURL(/[?&]gene=TANC1/);
    await expect(gene).toHaveValue('TANC1');
  });

  test('the homepage tile leads to it', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');

    await page.locator('app-home-shortcuts').getByRole('link', { name: 'IDG' }).click();

    await expect(page).toHaveURL(/\/idg$/);
    await expect(
      page.getByRole('heading', { name: 'Illuminating the Druggable Genome' })
    ).toBeVisible();
  });
});
