import { test, expect } from './support/backend';

/**
 * "Cite us" opens the citation for the pathway on screen.
 *
 * The dialog and its component are fetched when it is first opened rather than
 * with the page (#356), so the first click has something to wait for. Nothing
 * tested the dialog before; writing this found the button had no name.
 */
test('Cite us opens the citation for the pathway on screen, and closes', async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));
  // The request carries today's date (?dateAccessed=...), so no recording can
  // match it; answered here in the service's own shape.
  await page.route('**/ContentService/citation/pathway/R-HSA-69620?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        pathwayCitation:
          "Yen, T.J. ,Khanna, K.K. ,Hoffmann, I. ,Walworth, N. & O'Donnell, M. (2005). Cell Cycle Checkpoints. Reactome, 97, https://reactome.org/content/detail/R-HSA-69620",
        imageCitation:
          'Image Citation for Cell Cycle Checkpoints. Reactome, 97, https://reactome.org/content/detail/R-HSA-69620',
      }),
    })
  );
  await page.goto('/PathwayBrowser/R-HSA-69620');
  // By its name: it had none, only a tooltip, so a screen reader announced an
  // unnamed button.
  await page.getByRole('button', { name: 'Cite us' }).click({ timeout: 60_000 });
  const dialog = page.locator('cr-citation');
  await expect(dialog.getByRole('heading', { name: 'Cite Us!' })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('heading', { name: 'Pathway' })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('mat-dialog-content')).toContainText(
    '(2005). Cell Cycle Checkpoints'
  );
  await dialog.locator('.close-button').click();
  await expect(dialog).toHaveCount(0);
  expect(thrown).toEqual([]);
});

test("the site's Cite Us button opens the citation from any page", async ({ page }) => {
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Cite Us', exact: true }).click({ timeout: 60_000 });
  const dialog = page.locator('cr-citation');
  await expect(dialog.getByRole('heading', { name: 'Cite Us!' })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('mat-dialog-content')).not.toBeEmpty({ timeout: 30_000 });
  expect(thrown).toEqual([]);
});

test('two quick clicks open one citation, not two', async ({ page }) => {
  // The dialog's code loads on the first click, so a second click can land
  // while it is still on its way; each used to open a dialog of its own.
  // Without the guards, a development build (what this suite serves) refuses
  // the second dialog by throwing -- Material checks for a duplicate id only in
  // dev mode -- so the count stays at one and the failed open is what shows. A
  // production build opens two, which the count catches. Both are checked.
  // Matched narrowly: a citation request that fails is a different problem.
  const failures: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /exists already|Could not open the citation/.test(message.text())
    )
      failures.push(message.text());
  });
  // Unhandled, should the component ever stop catching it.
  page.on('pageerror', (error) => failures.push(String(error)));
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Cite Us', exact: true });
  await expect(button).toBeVisible({ timeout: 60_000 });
  // Both clicks in one task, so the second is certain to land while the first
  // is still loading. Two pointer clicks raced the load instead: on a fast
  // machine the dialog was already open and the second click landed on its
  // backdrop, closing it -- a test of timing, not of the guard.
  await button.evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
  const dialog = page.locator('cr-citation');
  await expect(dialog.getByRole('heading', { name: 'Cite Us!' })).toBeVisible({ timeout: 30_000 });
  // Long enough for a second dialog to have opened, had one been coming.
  await page.waitForTimeout(2000);
  await expect(dialog).toHaveCount(1);
  expect(failures).toEqual([]);
});
