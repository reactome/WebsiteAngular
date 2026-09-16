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

/**
 * Deleting a resource takes it off the diagram.
 *
 * It did not. `deleteCustomResource` selected elements with
 * `[resource = '${resource}']`, interpolating an InteractorToken object into the
 * string "[object Object]" -- a selector matching nothing. Measured on beta
 * before the fix: one badge before, one badge after, and the list empty. The
 * button looked like it worked because the button is what disappeared.
 *
 * Its click also bubbled to the list option it sits inside, whose own handler
 * chooses the resource, so deleting one immediately asked the app to draw it
 * again and threw on the page.
 */
test.describe('Deleting a resource you added', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('removes it from the diagram, not just from the list', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(String(error)));

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
    await page.getByLabel('Name').fill('ToDelete');
    await page.getByRole('radio', { name: /copy & paste/i }).click();
    await page.locator('textarea').fill(`#ID_A\tID_B\n${accessions[0]}\tQ99741\n`);
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 60_000 });

    const badges = () =>
      page.evaluate(() => {
        const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
        return cy?.nodes('.InteractorOccurrences').length ?? 0;
      });
    await expect.poll(badges, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.locator('cr-interactors mat-list-option button').first().click();

    await expect(page.locator('cr-interactors mat-list-option')).toHaveCount(0);
    await expect.poll(badges, { message: 'and off the diagram', timeout: 30_000 }).toBe(0);
    expect(thrown, 'without throwing on the way out').toEqual([]);
  });
});

/**
 * Nothing in the dialog is printed over anything else.
 *
 * Reported from beta: the name field's hint ran to three lines and printed
 * straight over the tab labels. Material reserves a single line of subscript for
 * a hint, and that field was half the dialog's width, so a sentence that read
 * fine in the markup did not fit on screen.
 *
 * Asserted by comparing the boxes the text actually occupies rather than by
 * looking at a picture, so it holds at any width and says which two collided.
 */
test.describe('The dialog layout', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  for (const width of [1600, 1280]) {
    test(`has no overlapping text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDialog(page);
      await page.getByRole('button', { name: /what can i add here/i }).click();
      await page.waitForTimeout(500);

      const clashes = await page.evaluate(() => {
        const blocks = [
          ...document.querySelectorAll(
            '.mat-mdc-dialog-container mat-hint, .mat-mdc-dialog-container .mdc-tab__text-label, .mat-mdc-dialog-container .share-choice, .mat-mdc-dialog-container .format-help-body, .mat-mdc-dialog-container mat-dialog-actions'
          ),
        ];
        const boxes = blocks.map((block) => ({
          text: (block.textContent ?? '').trim().slice(0, 30),
          box: block.getBoundingClientRect(),
        }));
        const found: string[] = [];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].box;
            const b = boxes[j].box;
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
              found.push(`"${boxes[i].text}" over "${boxes[j].text}"`);
            }
          }
        }
        return { checked: boxes.length, found };
      });

      expect(clashes.checked, 'the blocks being compared are present').toBeGreaterThan(3);
      expect(clashes.found, 'text printed over other text').toEqual([]);
    });
  }
});

/**
 * What the "share by link" choice actually promises.
 *
 * Ticking it uploads the data so the overlay can be opened by someone else. It
 * could not: the address carries `?overlay=<token>`, and on a fresh load that
 * string was cast straight to an InteractorToken, so `summary` was undefined and
 * the fetch returned at its first line. Silently. Measured before the fix: the
 * link opened with 0 badges where the session that made it had 1.
 *
 * Also here because the same block identifies a custom resource by token while
 * `currentResource()` holds its name, so clicking an active one never put it
 * away -- the one gesture that branch exists for.
 */
test.describe('An overlay shared by link', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  const badges = (page: Page) =>
    page.evaluate(() => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      return cy?.nodes('.InteractorOccurrences').length ?? 0;
    });

  test('opens for whoever follows it, and can be put away again', async ({ page }) => {
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
    await page.getByLabel('Name').fill('SharedByLink');
    await page.getByRole('radio', { name: /copy & paste/i }).click();
    await page.locator('textarea').fill(`#ID_A\t${'ID_B'}\n${accessions[0]}\tQ99741\n`);
    // The opt-in, which is what makes a token at all.
    await page.locator('.share-choice input').check();
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 60_000 });

    await expect.poll(() => badges(page), { timeout: 30_000 }).toBeGreaterThan(0);
    const drawn = await badges(page);

    const shared = page.url();
    expect(shared, 'the address carries a token').toMatch(/overlay=[0-9a-f]{8,}/);

    // Clicking the active custom resource puts it away.
    await page.locator('cr-interactors mat-list-option').first().click();
    await expect
      .poll(() => badges(page), { message: 'clicking it again puts it away', timeout: 30_000 })
      .toBe(0);

    // A fresh load of the link someone was given.
    await page.goto(shared, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await expect
      .poll(() => badges(page), { message: 'the shared link draws it', timeout: BOOT_TIMEOUT })
      .toBe(drawn);

    // And it is listed, so whoever followed the link can clear it rather than
    // facing an overlay with no control for it.
    await page.locator('.species-interactor-container .interactor').click();
    await expect(page.locator('cr-interactors mat-list-option')).toContainText(/Shared \(/);
  });
});
