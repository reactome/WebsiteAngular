import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// GSAServer is a shared production service, and no test calls it: the harness
// (support/backend.ts) answers the reads the form makes on load from captured
// copies, and fails a test that makes any request it did not stub. This copy
// is read here too, for the test that turns reports on.
const gsaMethods = JSON.parse(
  // __dirname, not import.meta.url: this package is CommonJS, and import.meta
  // makes Playwright's loader treat the spec as ESM and fail to load it at all.
  readFileSync(join(__dirname, 'fixtures', 'gsa-methods.json'), 'utf8')
);

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
  test('shows the analysis methods GSAServer lists', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=quantitative');

    await expect(
      page.getByText('Step 1: Select one of the available analysis methods')
    ).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });

    // Methods arrive via an NgRx effect hitting /GSAServer/0.1/methods --
    // answered by the harness from a captured copy; no test calls the real
    // service. If the call fails the accordion renders empty and the wizard is
    // a dead end, so assert on the cards themselves.
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

    await expect(page.getByText('Step 2: Add and annotate your datasets')).toBeVisible({
      timeout: 20_000,
    });
    // Dataset sources are a second backend-backed NgRx feature.
    await expect(page.getByText('Example Dataset')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Quantitative analysis: the landing page it replaced', () => {
  // reactome.org/gsa was a separate landing page with a Guided Tour button and
  // the method's citation; /gsa leads to this tab now, so both live here. The
  // tour itself was only reachable through a ?gsa-tour= parameter.
  test('offers the guided tour, and starts it', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    await expect(page.locator('gsa-method').first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    const before = page.url();
    await page.getByRole('button', { name: 'Guided tour' }).click();
    // The first step's own words: "Select method" is also the stepper's label,
    // which is on screen whether the tour started or not.
    await expect(page.getByText('Click "Camera" panel to select')).toBeVisible();
    // And it stays here. The step used to send the reader to /form, the
    // wizard's path in the stand-alone app the form came from.
    expect(page.url()).toBe(before);
    // Not twice at once.
    await expect(page.getByRole('button', { name: 'Guided tour' })).toBeDisabled();
  });

  // Later steps keep the first step's panels in the page, hidden, so a tour
  // started there points at nothing the reader can see; and going back to step
  // 1 resets their datasets. So it is offered from step 1 only.
  test('offers the tour from the first step only', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    const tour = page.getByRole('button', { name: 'Guided tour' });
    await page.locator('gsa-method', { hasText: 'Camera' }).click({ timeout: BOOT_TIMEOUT });
    await expect(tour).toBeEnabled();
    await page.locator('button.mat-mdc-fab').first().click();
    await expect(page.getByText('Step 2: Add and annotate your datasets')).toBeVisible({
      timeout: 20_000,
    });
    await expect(tour).toBeDisabled();
  });

  test('cites the method', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    const citation = page.getByRole('link', { name: /Griss J et al/ });
    await expect(citation).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(citation).toHaveAttribute('href', 'https://europepmc.org/article/MED/32907876');
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

test.describe('Quantitative analysis: adding a dataset', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  // Captured once from the shared GSA service, so no test here loads a dataset
  // on it: the example list, the load and its status, and the dataset summary.
  const gsa = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'gsa-melanoma-example.json'), 'utf8')
  ) as Record<string, { status: number; body: unknown }>;

  async function stubGsa(page: Page) {
    for (const [path, reply] of Object.entries(gsa)) {
      const glob = `**/GSAServer/0.1/${path}${path === 'data/status' || path === 'data/summary' ? '/**' : ''}`;
      await page.route(glob, (route) =>
        route.fulfill({
          status: reply.status,
          contentType: typeof reply.body === 'string' ? 'text/plain' : 'application/json',
          body: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
        })
      );
    }
  }

  /** Camera on the melanoma example, through to Step 4, which submits it. */
  async function submitCameraOnMelanoma(page: Page) {
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    await page.locator('gsa-method', { hasText: 'Camera' }).click({ timeout: BOOT_TIMEOUT });
    await page.locator('button.mat-mdc-fab').first().click();
    await page.getByText('Melanoma RNA-seq example').first().click({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Upload table' })).toBeVisible({
      timeout: 30_000,
    });
    for (let step = 0; step < 2; step++) {
      await page.locator('button:visible', { hasText: 'keyboard_arrow_down' }).last().click();
      await page.waitForTimeout(1000);
    }
    await page.getByRole('button', { name: 'Save Dataset' }).click({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Step 3: Analysis Options')).toBeVisible({ timeout: 20_000 });
    await page
      .locator('button.mat-mdc-fab:visible', { hasText: 'keyboard_arrow_right' })
      .last()
      .click();
  }

  // The first version of the hint widened its column, the row wrapped, and
  // Continue ended up below the dataset card -- present, and out of view.
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
  ]) {
    test(`Continue stays on screen at ${width}x${height} while it waits`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stubGsa(page);
      await page.goto('/PathwayBrowser?analysisTab=quantitative');
      await page.locator('gsa-method', { hasText: 'Camera' }).click({ timeout: BOOT_TIMEOUT });
      await page.locator('button.mat-mdc-fab').first().click();
      await page.getByText('Melanoma RNA-seq example').first().click({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Upload table' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByRole('button', { name: 'Save the dataset to continue' })
      ).toBeInViewport();
      await expect(page.getByText('Save the dataset to continue')).toBeInViewport();
    });
  }

  // Deleting a dataset removes its form. A guard on that path rather than a
  // regression test: it passes on the code before #342 as well, because the
  // form's delayed stepper move was already cancelled on destroy. What it
  // holds is that nothing on the way out reads the form's view queries --
  // their stepper is inside an @if on the dataset, and the harness fails any
  // test that sees an Angular error such as NG0951.
  test('a dataset can be deleted, and its form goes with it', async ({ page }) => {
    await stubGsa(page);
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    await page.locator('gsa-method', { hasText: 'Camera' }).click({ timeout: BOOT_TIMEOUT });
    await page.locator('button.mat-mdc-fab').first().click();
    await page.getByText('Melanoma RNA-seq example').first().click({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Upload table' })).toBeVisible({
      timeout: 30_000,
    });
    const forms = page.locator('gsa-dataset-form');
    const before = await forms.count();
    expect(before, 'a dataset form is open').toBeGreaterThan(0);

    await page.locator('gsa-dataset-form button[mattooltip="Delete dataset"]').first().click();
    await expect(forms).toHaveCount(before - 1, { timeout: 10_000 });
    // Past the stepper's delayed advance, which is where a stray read would land.
    await page.waitForTimeout(500);
  });

  // "Every dataset is saved" was true of no datasets at all, so a reader who
  // deleted every card could Continue with nothing to analyse (#308).
  test('will not continue with no dataset, and says to add one', async ({ page }) => {
    await stubGsa(page);
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    await page.locator('gsa-method', { hasText: 'Camera' }).click({ timeout: BOOT_TIMEOUT });
    await page.locator('button.mat-mdc-fab').first().click();
    const forms = page.locator('gsa-dataset-form');
    await expect(forms).toHaveCount(1, { timeout: 20_000 });

    await page.locator('gsa-dataset-form button[mattooltip="Delete dataset"]').click();
    await expect(forms).toHaveCount(0, { timeout: 10_000 });

    const onward = page.getByRole('button', { name: 'Add a dataset to continue' });
    await expect(onward).toBeDisabled();
    await expect(page.getByText('Add a dataset to continue')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  });

  // Continue stays disabled until the dataset is saved, and it used to say only
  // "Continue" -- so a reader who had chosen a dataset saw a dead button, with
  // the Save button several steps down inside the dataset card.
  test('says what it is waiting for, and continues once the dataset is saved', async ({ page }) => {
    await stubGsa(page);
    await page.goto('/PathwayBrowser?analysisTab=quantitative');
    await page.locator('gsa-method', { hasText: 'Camera' }).click({ timeout: BOOT_TIMEOUT });
    await page.locator('button.mat-mdc-fab').first().click();
    await page.getByText('Melanoma RNA-seq example').first().click({ timeout: 20_000 });

    await expect(page.getByText('Save the dataset to continue')).toBeVisible({ timeout: 20_000 });

    // The sample table is what the loaded dataset shows first.
    await expect(page.getByRole('button', { name: 'Upload table' })).toBeVisible({
      timeout: 30_000,
    });
    // Through the card's own steps (statistical design, parameters) to Save.
    for (let step = 0; step < 2; step++) {
      await page.locator('button:visible', { hasText: 'keyboard_arrow_down' }).last().click();
      await page.waitForTimeout(1000);
    }
    await page.getByRole('button', { name: 'Save Dataset' }).click({ timeout: 20_000 });
    await expect(page.getByText('Save the dataset to continue')).toHaveCount(0);
    const onward = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(onward).toBeEnabled();
    await onward.click();
    await expect(page.getByText('Step 3: Analysis Options')).toBeVisible({ timeout: 20_000 });
  });

  // ReactomeGSA delivers the result to the Reactome server the request names,
  // and only a site reading that server's Analysis Service can open it. The
  // profile named one all along -- `dev` here, the development profile -- but
  // nothing read it, so every deployment asked for `production`, and beta could
  // show none of its own results (curator review, item 3b).
  test("asks ReactomeGSA to deliver to this deployment's server", async ({ page }) => {
    await stubGsa(page);
    let submitted: { parameters?: { name: string; value: string }[] } | null = null;
    await page.route('**/GSAServer/0.1/analysis', (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill({ contentType: 'text/plain', body: 'test-analysis-id' });
    });
    // Submitting starts a status poll; it is answered, not sent on.
    await page.route('**/GSAServer/0.1/status/test-analysis-id', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-analysis-id', status: 'running', completed: 0 }),
      })
    );
    await submitCameraOnMelanoma(page);

    await expect.poll(() => submitted, { timeout: 20_000 }).not.toBeNull();
    const parameters: { name: string; value: string }[] =
      (submitted as { parameters?: { name: string; value: string }[] } | null)?.parameters ?? [];
    expect(parameters.find((p) => p.name === 'reactome_server')?.value).toBe('dev');
  });

  // The report card's progress bar was bound to the fraction complete (0 to 1)
  // with the "* 100" outside the binding, so it never passed 1%; its percentage
  // was unrounded ("33.33333333%"); and a report whose name was not one of the
  // three expected showed as an empty button.
  test('shows how far the reports have got, and every report it is given', async ({ page }) => {
    // Reports on, so the Report card is shown.
    const methods = JSON.parse(JSON.stringify(gsaMethods)) as typeof gsaMethods;
    for (const method of methods as { parameters?: { name: string; default?: string }[] }[]) {
      for (const parameter of method.parameters ?? []) {
        if (parameter.name === 'create_reports') parameter.default = 'True';
      }
    }
    await stubGsa(page);
    await page.route('**/GSAServer/**/methods', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(methods) })
    );
    const id = 'test-analysis-id';
    await page.route('**/GSAServer/0.1/analysis', (route) =>
      route.fulfill({ contentType: 'text/plain', body: id })
    );
    await page.route(`**/GSAServer/0.1/status/${id}`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ id, status: 'complete', completed: 1, description: 'Done' }),
      })
    );
    // No token in the link: with one, the Pathway Browser takes the result and
    // closes the form before the reports can be seen.
    await page.route(`**/GSAServer/0.1/result/${id}`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          release: '97',
          method_name: 'Camera',
          results: [],
          reactome_links: [],
          mappings: [],
        }),
      })
    );
    // Running until the test has looked, then complete.
    let reportsDone = false;
    await page.route(`**/GSAServer/0.1/report_status/${id}`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          reportsDone
            ? {
                id,
                status: 'complete',
                completed: 1,
                description: 'Reports created',
                reports: [
                  {
                    name: 'PDF Report',
                    url: 'https://example.org/report.pdf',
                    mimetype: 'application/pdf',
                  },
                  {
                    name: 'Pathway figures',
                    url: 'https://example.org/figures.zip',
                    mimetype: 'application/zip',
                  },
                ],
              }
            : { id, status: 'running', completed: 1 / 3, description: 'Creating the Excel report' }
        ),
      })
    );

    await submitCameraOnMelanoma(page);

    const card = page
      .locator('mat-card', { hasText: 'Report' })
      .filter({ has: page.locator('mat-card-title', { hasText: /^Report$/ }) });
    await expect(card.getByText('Report loading: 33%', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    // Out of 100: bound to the bare fraction, it read 0.33.
    const bar = card.locator('mat-progress-bar');
    await expect
      .poll(async () => Math.round(Number(await bar.getAttribute('aria-valuenow'))))
      .toBe(33);

    reportsDone = true;
    await expect(card.getByRole('link', { name: /PDF Report/ })).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('link', { name: /Pathway figures/ })).toBeVisible();
  });
});
