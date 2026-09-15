/**
 * "Add overlay resource": the dialog that adds your own interactions.
 *
 * Reported from beta as "it opens but you can't close it", and that is exactly
 * what it was. `mat-dialog-close` is a directive, and `MatDialogClose` was not in
 * the component's imports -- so the attribute sat inert on the button labelled
 * Close and nothing happened when it was pressed. Escape and the backdrop still
 * worked, neither of which the dialog mentions.
 *
 * Nothing failed to compile and nothing threw: a missing Material directive is a
 * silent no-op, which is why this file exists.
 *
 * The format the service wants was measured against beta's ContentService on
 * 2026-09-15 rather than inferred: a `#ID_A<tab>ID_B` header, then two
 * identifiers per line. Three columns are refused; without the header the first
 * pair is read as the header and silently dropped.
 */
import { test, expect, type Page } from '@playwright/test';

const PATHWAY = 'R-HSA-1368108';
const BOOT_TIMEOUT = 90_000;

type CytoscapeHost = Element & {
  _cyreg?: {
    cy?: {
      nodes(selector?: string): { length: number; map<T>(fn: (n: GraphNode) => T): T[] };
    };
  };
};
interface GraphNode {
  data(key?: string): unknown;
}

const dialog = (page: Page) => page.locator('.mat-mdc-dialog-container');

/** Open the diagram, the interactors panel, and the dialog. */
async function openDialog(page: Page) {
  await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
  await page.waitForTimeout(4000);
  await page.locator('.species-interactor-container .interactor').click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Add overlay resource' }).click();
  await expect(dialog(page)).toHaveCount(1);
}

test.describe('Adding your own interaction resource', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('closes when you press the button that says Close', async ({ page }) => {
    await openDialog(page);
    // Scoped to the footer: the X in the title is also named Close, and being
    // able to close it from the title is not what was reported broken.
    await dialog(page)
      .locator('mat-dialog-actions, .mat-mdc-dialog-actions')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(dialog(page), 'the reported bug').toHaveCount(0);
  });

  test('and from the X in its title', async ({ page }) => {
    await openDialog(page);
    await page.getByRole('button', { name: 'Close without adding anything' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('says what it wants, before you get it wrong', async ({ page }) => {
    await openDialog(page);
    await page.getByRole('button', { name: /what can i add here/i }).click();

    const help = dialog(page).locator('.format-help-body');
    await expect(help).toContainText('#ID_A');
    // The two things the service is strict about, both measured.
    await expect(help, 'the header matters').toContainText(/header/i);
    await expect(help, 'and so does the column count').toContainText(
      /third is refused|two columns/i
    );
  });

  test('says why, when the service refuses, and stays open to be fixed', async ({ page }) => {
    await openDialog(page);
    await page.getByLabel('Name').fill('BadData');
    await page.getByRole('radio', { name: /copy & paste/i }).click();
    await page.locator('textarea').fill('this is not tabular');
    await page.getByRole('button', { name: /submit/i }).click();

    // The service's own words, which say what to fix. Before this the spinner
    // simply ran forever with nothing said.
    await expect(dialog(page).locator('.upload-error')).toContainText(/parse/i, {
      timeout: 30_000,
    });
    await expect(dialog(page), 'still open, with the data still in it').toHaveCount(1);
    await expect(dialog(page).locator('mat-spinner')).toHaveCount(0);
  });

  test('draws the interactions you gave it', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);

    // Accessions the diagram actually carries, so the overlay has something to
    // attach to -- naming one here would be a test about a guess.
    const accessions = await page.evaluate(() => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      if (!cy) throw new Error('no cytoscape instance on #cytoscape');
      return [...new Set(cy.nodes('[acc]').map((node) => node.data('acc') as string))].filter(
        Boolean
      );
    });
    expect(accessions.length, 'the diagram has identifiers to match').toBeGreaterThan(1);

    await page.locator('.species-interactor-container .interactor').click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Add overlay resource' }).click();
    await expect(dialog(page)).toHaveCount(1);

    await page.getByLabel('Name').fill('MyPartners');
    await page.getByRole('radio', { name: /copy & paste/i }).click();
    await page
      .locator('textarea')
      .fill(`#ID_A\tID_B\n${accessions[0]}\tQ99741\n${accessions[0]}\tP25205\n`);
    await page.getByRole('button', { name: /submit/i }).click();

    await expect(dialog(page), 'it closes once accepted').toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('cr-interactors mat-list-option')).toContainText('MyPartners');

    // The point of all of it: something on the diagram.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
            return cy?.nodes('.InteractorOccurrences').length ?? 0;
          }),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);
  });
});
