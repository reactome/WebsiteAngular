import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A request that fails is not an answer of "nothing".
 *
 * The interactor page said "Interactor not found" whatever went wrong, so a
 * server error read as an accession Reactome has no interactions for. Only a
 * 404 means that.
 */

const LOAD = 60_000;
// Real, with interactions: BRCA1.
const KNOWN = 'P38398';
// Real, and in no other recording: the stubbed failure for it is pooled, and
// would otherwise be what another test borrowed.
const FAILING = 'O15151';
// Not an accession: the service answers 404.
const UNKNOWN = 'ZZZ999';

const interactions = (acc: string) =>
  new RegExp(`/interactors/static/molecule/${acc}/withEntities(\\?|$)`);

test.describe('The interactor page', () => {
  test('shows the partners of an interactor', async ({ page }) => {
    await page.goto(`/content/detail/interactor/${KNOWN}`);
    await expect(page.locator('.interactions-table tbody tr').first()).toBeVisible({
      timeout: LOAD,
    });
  });

  test('says an accession with no interactions was not found', async ({ page }) => {
    await page.goto(`/content/detail/interactor/${UNKNOWN}`);
    await expect(page.getByRole('heading', { name: 'Interactor not found' })).toBeVisible({
      timeout: LOAD,
    });
  });

  test('does not call an interactor it could not load "not found"', async ({ page }) => {
    await failWith(page, interactions(FAILING), 500);
    await page.goto(`/content/detail/interactor/${FAILING}`);
    await expect(page.getByRole('heading', { name: "Couldn't load this interactor" })).toBeVisible({
      timeout: LOAD,
    });
    await expect(page.getByText('Please try again later.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Interactor not found' })).toHaveCount(0);
  });
});

function failWith(page: Page, url: RegExp, status: number) {
  return page.route(url, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: status }),
    })
  );
}
