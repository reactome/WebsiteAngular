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

    // What is wrong with the data, in words that say what to fix. Before this
    // the spinner simply ran forever with nothing said at all.
    //
    // The reading now happens in the page, so this is the local parser's message
    // rather than the service's "Could not Parse your file" -- the same job, and
    // it can name the offending line.
    await expect(dialog(page).locator('.upload-error')).toContainText(/two identifiers|parse/i, {
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

/**
 * Where a reader's own data goes.
 *
 * It used to go to the server always, with nothing saying so: parsed into
 * `ContentService/custom/<token>.bin` and addressed by a token that then appears
 * in the page's address. Traced 2026-09-15 -- a fresh upload read back by a
 * request carrying no session, a store of 323 files whose oldest is from 2019,
 * and no expiry.
 *
 * A file or a paste is now read in the page instead, unless the reader asks for
 * a link they can share. Asserted on the requests rather than on the checkbox,
 * because the checkbox is the promise and the requests are whether it was kept.
 */
test.describe("A reader's own data", () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  /** Add a pasted resource, reporting every request that could carry the data out. */
  async function addPasted(page: Page, name: string, share: boolean) {
    const sent: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/interactors/upload/') || url.includes('/interactors/token/')) {
        sent.push(url);
      }
    });

    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);

    const accessions = await page.evaluate(() => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      if (!cy) throw new Error('no cytoscape instance on #cytoscape');
      return [...new Set(cy.nodes('[acc]').map((node) => node.data('acc') as string))].filter(
        Boolean
      );
    });

    await page.locator('.species-interactor-container .interactor').click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Add overlay resource' }).click();
    await expect(dialog(page)).toHaveCount(1);
    await page.getByLabel('Name').fill(name);
    await page.getByRole('radio', { name: /copy & paste/i }).click();
    await page.locator('textarea').fill(`#ID_A\tID_B\n${accessions[0]}\tQ99741\n`);
    if (share) await page.locator('.share-choice input').check();
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 60_000 });
    return sent;
  }

  test('stays in the browser, and still draws', async ({ page }) => {
    const sent = await addPasted(page, 'LocalOnly', false);

    expect(sent, 'nothing left the browser').toEqual([]);
    await expect(page.locator('cr-interactors mat-list-option')).toContainText('LocalOnly');
    // No token, so nothing to put in the address -- an `?overlay=` that resolves
    // to nothing would look like a bug rather than like privacy.
    await expect(page).toHaveURL((url) => url.searchParams.get('overlay') === null);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
          return cy?.nodes('.InteractorOccurrences').length ?? 0;
        })
      )
      .toBeGreaterThan(0);
  });

  test('is uploaded only when a shareable link is asked for', async ({ page }) => {
    const sent = await addPasted(page, 'SharedOne', true);

    expect(
      sent.some((url) => url.includes('/upload/')),
      'the opt-in still works'
    ).toBe(true);
    // And then the address carries it, which is the point of asking.
    await expect(page).toHaveURL((url) => (url.searchParams.get('overlay') ?? '').length > 0);
  });
});
