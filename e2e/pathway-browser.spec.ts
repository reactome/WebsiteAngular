import { test, expect } from './support/backend';
import type { Page } from '@playwright/test';

// Smoke coverage for the Pathway Browser shell.
//
// Almost everything here depends on a live ContentService, so these tests double
// as a check that the backend wiring in environment.ts still resolves. When the
// dev server is the target, that means proxy.conf.json must route
// /ContentService -- otherwise the dev server answers with index.html and the
// tree silently renders empty.
//
// Note on assertions: several component host elements here (cr-viewport,
// cr-search) are `display: inline` and measure 0x0 because their content is
// absolutely positioned. They are real and mounted, but playwright's
// toBeVisible() treats a zero-area box as hidden -- so assert toBeAttached() on
// those, and save toBeVisible() for elements that actually occupy space
// (mat-tree, canvas, the toolbar buttons).

// The Pathway Browser boots a diagram renderer and several backend calls, so
// give it noticeably more room than a plain content page.
const BOOT_TIMEOUT = 45_000;

test.describe('Pathway Browser', () => {
  test('boots with the toolbar, search and viewport mounted', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    await expect(page.locator('cr-viewport')).toBeAttached({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('cr-search')).toBeAttached({ timeout: BOOT_TIMEOUT });
    await expect(page.getByRole('button', { name: /analyze/i })).toBeVisible({
      timeout: BOOT_TIMEOUT,
    });
  });

  test('pathway tree is populated from the backend', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    const tree = page.locator('mat-tree');
    await expect(tree).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Top-level human pathways. If ContentService is unreachable the tree still
    // renders as an empty shell, so assert on real content rather than the
    // container existing.
    for (const pathway of ['Autophagy', 'Cell Cycle', 'Metabolism', 'Disease']) {
      await expect(tree.getByText(pathway, { exact: true }).first()).toBeVisible({
        timeout: BOOT_TIMEOUT,
      });
    }
  });

  test('renders a diagram canvas', async ({ page }) => {
    await page.goto('/PathwayBrowser?tab=info');

    // The diagram is drawn on canvas by ngx-reactome-diagram; a canvas with real
    // dimensions is the cheapest reliable signal that the renderer initialised.
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('loads without uncaught page errors', async ({ page }) => {
    // Broad guard for the class of failure that is invisible in a screenshot:
    // a duplicate provideAnimations() once left every animation in the app
    // stuck, and a hung version lookup once blocked diagram downloads. Both
    // surfaced here first.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/PathwayBrowser?tab=info');
    await expect(page.locator('mat-tree')).toBeVisible({ timeout: BOOT_TIMEOUT });

    expect(pageErrors).toEqual([]);
  });
});

test.describe('Diagram search', () => {
  // Commented out wholesale in "Remove Overlay feature, feedback, and revert to
  // old site" (c4aca4d, May), which hid it from the public site as well as the
  // curator build it was aimed at. The component was never broken -- only its
  // markup was commented -- so this asserts the parts that would tell us if it
  // regressed again: suggestions, scopes and results.
  test('suggests terms and returns scoped results', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606');
    const input = page.locator('cr-search input').first();
    await expect(input).toBeVisible({ timeout: BOOT_TIMEOUT });

    await input.click();
    await input.fill('pten');
    await expect(page.locator('.suggest-line').first()).toBeVisible({ timeout: 20_000 });

    await input.press('Enter');
    const results = page.locator('cr-search .results');
    await expect(results).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Both scopes report counts: searching only the open diagram, and everything.
    await expect(results).toContainText(/Current pathway/i);
    await expect(results).toContainText(/All pathways/i);
  });
});

test('publication authors link to their person pages', async ({ page }) => {
  // These links were commented out, and for a reason: the markup referenced a
  // bare `environment` the component never had, so the hrefs came out as
  // "undefined/content/detail/person/...". They use the CONTENT_DETAIL constant
  // now, the same one object-tree uses for entity links.
  await page.goto('/PathwayBrowser/R-HSA-109606?tab=details');

  // Attached, not visible: publications sit in the References section further
  // down the panel, so the links are in the DOM without being on screen. What
  // matters is that they exist and point somewhere real.
  const authorLink = page.locator('cr-publication a[href*="/person/"]').first();
  await expect(authorLink).toBeAttached({ timeout: 25_000 });

  const href = await authorLink.getAttribute('href');
  expect(href, 'href must be absolute and host-aware, not "undefined/..."').toMatch(
    /^https?:\/\/[^/]+\/content\/detail\/person\/\d+$/
  );
  if (!href) throw new Error('no href to follow');

  // and it has to actually land on a person -- once this page has finished
  // loading, or leaving it cuts its requests off mid-response and the
  // recording keeps the truncated answers (scripts/check-har.mjs refuses them).
  await page.waitForLoadState('networkidle');
  await page.goto(href);
  await expect(page.locator('app-person-detail')).toContainText(/Publications|Authored/, {
    timeout: 25_000,
  });
});

test('clicking a details tab writes the matching tab to the URL', async ({ page }) => {
  // The tab names were a fixed array that no longer matched what the template
  // renders: it still listed 'expression', whose tab is not rendered, in the
  // position Results now occupies, so clicking Results wrote ?tab=expression.
  // The list is derived from the variant now, since Results and Download are
  // absent from the curator build and a static array shifts as soon as one is.
  await page.goto('/PathwayBrowser/R-HSA-109606?tab=details');
  await expect(page.locator('cr-details-panel')).toBeAttached({ timeout: BOOT_TIMEOUT });

  for (const name of ['Info', 'Download', 'Details']) {
    const tab = page.locator('.label-text', { hasText: new RegExp(`^${name}$`) }).first();
    await expect(tab).toBeVisible({ timeout: 25_000 });
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`tab=${name.toLowerCase()}`), { timeout: 15_000 });
  }
});

test.describe('Details panel deep links', () => {
  // A shared link naming a tab used to be discarded on arrival: the defaulting
  // effect set the tab from hasResult()/hasDetail() without checking whether the
  // URL already named one, so ?tab=download became ?tab=details.
  for (const [tab, content] of [
    ['download', 'cr-download-tab'],
    ['info', 'cr-info-tab'],
    ['molecule', 'cr-molecule-tab'],
  ] as const) {
    test(`?tab=${tab} opens that tab`, async ({ page }) => {
      await page.goto(`/PathwayBrowser/R-HSA-109606?tab=${tab}`);
      await expect(page.locator(content)).toBeAttached({ timeout: BOOT_TIMEOUT });
      // and the parameter survives, rather than being rewritten under the user
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
    });
  }

  test('a link with no tab still defaults sensibly', async ({ page }) => {
    // The defaults are what make an analysis open on its results, so they have
    // to keep working for links that name nothing.
    await page.goto('/PathwayBrowser/R-HSA-109606');
    await expect(page).toHaveURL(/tab=(details|info|results)/, { timeout: BOOT_TIMEOUT });
  });
});

test.describe('Expression tab (spec 024)', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  const heatmap = (page: Page) => page.locator('cr-expression-heatmap');
  const names = (page: Page) => heatmap(page).locator('.name').allInnerTexts();

  test("draws the pathway's own genes, asking EBI nothing", async ({ page }) => {
    // Expression Atlas's widget drew the same 29 genes, one marker per tissue
    // (LINCADL, MIR1302-7 ...), for every pathway: it ignores the genes it is
    // asked about. The heatmap is now the selection's own genes.
    const ebi: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('ebi.ac.uk/gxa')) ebi.push(r.url());
    });
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=details');
    const tab = page.locator('.label-text', { hasText: /^Expression$/ }).first();
    await expect(tab).toBeVisible({ timeout: BOOT_TIMEOUT });
    await tab.click();
    await expect(page.locator('cr-expression-tab .counts')).toHaveText('59 of 59 genes shown', {
      timeout: 60_000,
    });
    await heatmap(page).getByRole('button', { name: 'By name' }).click();
    const shown = await names(page);
    for (const gene of ['APAF1', 'BAX', 'BCL2', 'CASP9'])
      expect(shown, `${gene} is drawn`).toContain(gene);
    expect(shown, "none of Atlas's default genes").not.toContain('LINCADL');
    await expect(page.locator('cr-expression-tab .source')).toContainText('E-MTAB-2836');
    expect(ebi, 'nothing asked of Expression Atlas').toEqual([]);
  });

  test('says what a cell holds, to the keyboard too', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const canvas = heatmap(page).locator('canvas');
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await expect(heatmap(page).locator('.details')).toHaveText(
      /^\S+ in adrenal gland:\s+median [\d.,]+ TPM \(range [\d.,]+–[\d.,]+, quartiles [\d.,]+–[\d.,]+, \d+ samples\)$/
    );
    await expect(heatmap(page).locator('.legend')).toContainText('Median TPM');
  });

  test('says what a cell holds when pointed at', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const canvas = heatmap(page).locator('canvas');
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });
    await canvas.scrollIntoViewIfNeeded();
    // The first row's first tissue: the cell spans 17 by 13 pixels.
    await canvas.hover({ position: { x: 5, y: 5 } });
    await expect(heatmap(page).locator('.details')).toHaveText(
      /^\S+ in adipose tissue:\s+median [\d.,]+ TPM \(range/
    );
  });

  test('draws one protein, chosen by its reference, as one row', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?select=uniprot:P10415&tab=expression');
    await expect(page.locator('cr-expression-tab .counts')).toHaveText('1 of 1 genes shown', {
      timeout: BOOT_TIMEOUT,
    });
    expect(await names(page)).toEqual(['BCL2']);
  });

  test('lists the genes not shown, each with its reason (FR-007)', async ({ page }) => {
    // Regulated Necrosis holds two viral proteins (influenza's NS, a poxvirus's
    // RIR1): another species', never drawn with human data, and said so.
    await page.goto('/PathwayBrowser/R-HSA-5218859?tab=expression');
    const tab = page.locator('cr-expression-tab');
    await expect(tab.locator('.counts')).toHaveText('61 of 63 genes shown', {
      timeout: BOOT_TIMEOUT,
    });
    const notShown = tab.locator('.not-shown');
    await notShown.locator('summary').click();
    await expect(notShown.locator('summary')).toHaveText('2 not shown, and why');
    expect((await notShown.locator('li').allInnerTexts()).sort()).toEqual([
      'UniProt:P03496 NS: another species',
      'UniProt:P08543 RIR1: another species',
    ]);
  });

  test("draws a complex's genes alone", async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?select=R-HSA-114268&tab=expression');
    await expect(page.locator('cr-expression-tab .counts')).toHaveText('2 of 2 genes shown', {
      timeout: BOOT_TIMEOUT,
    });
    expect((await names(page)).sort()).toEqual(['BAD', 'BCL2']);
  });

  test('says a chemical has no genes, and draws nothing', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?select=chebi:30616&tab=expression');
    await expect(page.locator('cr-expression-tab')).toContainText(
      'This entry has no genes with expression data',
      { timeout: BOOT_TIMEOUT }
    );
    await expect(heatmap(page)).toHaveCount(0);
  });

  test('says expression is not available for a species with no tissue experiment', async ({
    page,
  }) => {
    // The fly's baseline experiments are strains and embryonic stages, not
    // tissues: none is listed (spec 024, research R8).
    await page.goto('/PathwayBrowser/R-DME-109606?tab=expression');
    await expect(page.locator('cr-expression-tab')).toContainText(
      'Expression data is not available for Drosophila melanogaster',
      { timeout: BOOT_TIMEOUT }
    );
    await expect(heatmap(page)).toHaveCount(0);
  });

  test('draws a rat pathway by organ and sex, the figure shaded by either sex (US5)', async ({
    page,
  }) => {
    await page.goto('/PathwayBrowser/R-RNO-109606?tab=expression');
    await expect(page.locator('cr-expression-tab .counts')).toContainText('genes shown', {
      timeout: BOOT_TIMEOUT,
    });
    await expect(page.locator('cr-expression-tab .source')).toContainText('E-GEOD-53960');
    const tissues = await heatmap(page).locator('.tissue').allInnerTexts();
    expect(tissues).toHaveLength(20);
    expect(tissues).toContain('liver (female)');
    expect(tissues).toContain('liver (male)');
    const figure = page.locator('cr-expression-anatomogram');
    const liver = figure.locator('#UBERON_0002107');
    await expect(liver).toBeAttached();
    await liver.dispatchEvent('mouseover');
    await expect(heatmap(page).locator('.tissue.current')).toHaveText('liver (female)');
    await figure.locator('.sex-switch').getByRole('button', { name: 'male', exact: true }).click();
    await figure.locator('#UBERON_0002107').dispatchEvent('mouseover');
    await expect(heatmap(page).locator('.tissue.current')).toHaveText('liver (male)');

    // Back on female, the heatmap's "liver (male)" column still outlines the
    // liver: the twelfth column, reached from the first by the keyboard.
    await figure
      .locator('.sex-switch')
      .getByRole('button', { name: 'female', exact: true })
      .click();
    await figure.locator('#UBERON_0002107').dispatchEvent('mouseleave');
    const canvas = heatmap(page).locator('canvas');
    await canvas.focus();
    for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowRight');
    await expect(heatmap(page).locator('.tissue.current')).toHaveText('liver (male)');
    await expect
      .poll(() =>
        figure.locator('#UBERON_0002107').evaluate((organ) => {
          const shape = organ.matches('path, polygon, ellipse, circle, rect')
            ? organ
            : organ.querySelector('path, polygon, ellipse, circle, rect');
          return shape ? (shape as SVGElement).style.getPropertyValue('stroke-width') : '';
        })
      )
      .toBe('1');
  });

  test('draws a cow pathway from cow tissues, with its one figure (US5)', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-BTA-109606?tab=expression');
    await expect(page.locator('cr-expression-tab .counts')).toContainText('genes shown', {
      timeout: BOOT_TIMEOUT,
    });
    await expect(page.locator('cr-expression-tab .source')).toContainText('E-MTAB-2798');
    expect(await heatmap(page).locator('.tissue').allInnerTexts()).toHaveLength(9);
    const figure = page.locator('cr-expression-anatomogram');
    await expect(figure.locator('#UBERON_0002107'), 'the liver').toBeAttached();
    await expect(
      figure.locator('.figure-switch'),
      'one figure, so no choice of figure'
    ).toHaveCount(0);
    // Skeletal muscle is UBERON_0001134 in the experiment, UBERON_0014892 in
    // the cow figure: matched all the same.
    await expect(figure.locator('#UBERON_0014892.measured'), 'skeletal muscle').toBeAttached();
    await expect(figure.locator('.licence')).toHaveText('Figure: Expression Atlas, CC BY 4.0');
  });

  test('draws a mouse pathway from mouse tissues (US5)', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-MMU-109606?tab=expression');
    await expect(page.locator('cr-expression-tab .counts')).toContainText('genes shown', {
      timeout: BOOT_TIMEOUT,
    });
    await expect(page.locator('cr-expression-tab .source')).toContainText('E-MTAB-3718');
    expect(await heatmap(page).locator('.tissue').allInnerTexts()).toEqual([
      'brain',
      'cerebellum',
      'heart',
      'kidney',
      'liver',
      'testis',
    ]);
    await expect(page.locator('cr-expression-anatomogram #UBERON_0002107')).toBeAttached();
  });

  /** An organ's computed fill on the anatomogram, as "rgb(r, g, b)". */
  const organFill = (page: Page, uberon: string) =>
    page.evaluate((id) => {
      const organ = document.querySelector(`cr-expression-anatomogram #${id}`);
      const shape = organ?.matches('path, polygon, ellipse, circle, rect')
        ? organ
        : organ?.querySelector('path, polygon, ellipse, circle, rect');
      return shape ? getComputedStyle(shape).fill : '';
    }, uberon);
  const brightness = (rgb: string) =>
    (rgb.match(/\d+/g) ?? []).slice(0, 3).reduce((sum, part) => sum + Number(part), 0);

  test('shades the body by the gene pointed at (FR-015)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('is-dark', 'false'));
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const canvas = heatmap(page).locator('canvas');
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('cr-expression-anatomogram #UBERON_0002106')).toBeAttached({
      timeout: 60_000,
    });
    // BCL2 is higher in spleen than in liver in E-MTAB-2836.
    await heatmap(page).getByRole('button', { name: 'By name' }).click();
    const row = (await names(page)).indexOf('BCL2');
    expect(row, 'BCL2 is in view').toBeGreaterThanOrEqual(0);
    await canvas.scrollIntoViewIfNeeded();
    await canvas.hover({ position: { x: 5, y: 14 * row + 5 } });
    await expect(page.locator('cr-expression-anatomogram .caption')).toHaveText('Shaded by BCL2');
    const spleen = await organFill(page, 'UBERON_0002106');
    const liver = await organFill(page, 'UBERON_0002107');
    expect(brightness(spleen), `spleen ${spleen} darker than liver ${liver}`).toBeLessThan(
      brightness(liver)
    );
  });

  test('keeps the figure in place while the pointer moves over the heatmap', async ({ page }) => {
    // It was parsed and inserted again on every move to a new cell (85 ms for
    // the male figure), stuttering a sweep across the tissues.
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const canvas = heatmap(page).locator('canvas');
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('cr-expression-anatomogram svg')).toBeAttached({ timeout: 60_000 });
    await page.evaluate(() => {
      const svg = document.querySelector('cr-expression-anatomogram svg') as
        (SVGElement & { kept?: boolean }) | null;
      if (svg) svg.kept = true;
    });
    await canvas.scrollIntoViewIfNeeded();
    for (const x of [5, 23, 41, 59]) await canvas.hover({ position: { x, y: 5 } });
    await expect(page.locator('cr-expression-anatomogram .caption')).toContainText('Shaded by');
    expect(
      await page.evaluate(
        () =>
          (
            document.querySelector('cr-expression-anatomogram svg') as
              (SVGElement & { kept?: boolean }) | null
          )?.kept === true
      ),
      'the same figure, not one inserted again'
    ).toBe(true);
  });

  test("picks out an organ's column when the organ is pointed at (FR-016)", async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const spleen = page.locator('cr-expression-anatomogram #UBERON_0002106');
    await expect(spleen).toBeAttached({ timeout: BOOT_TIMEOUT });
    await spleen.dispatchEvent('mouseover');
    await expect(page.locator('cr-expression-anatomogram .caption')).toHaveText('spleen');
    await expect(heatmap(page).locator('.tissue.current')).toHaveText('spleen');
  });

  test("draws each figure's own organs", async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const figure = page.locator('cr-expression-anatomogram');
    await expect(figure.locator('#UBERON_0000473')).toBeAttached({ timeout: BOOT_TIMEOUT });
    await figure.getByRole('button', { name: 'female' }).click();
    await expect(figure.locator('#UBERON_0000992'), 'an ovary').toBeAttached();
    await expect(figure.locator('#UBERON_0000473'), 'no testis').toHaveCount(0);
  });

  test('downloads the table shown, every value as the service answered it (FR-009)', async ({
    page,
  }) => {
    const answered = page.waitForResponse((r) =>
      r.url().includes('/ContentService/expression/R-HSA-109606')
    );
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const answer = (await (await answered).json()) as {
      rows: { gene: string; name: string; values: (number[] | null)[] }[];
      experiment: { accession: string; tissues: unknown[] };
    };
    await expect(heatmap(page).locator('canvas')).toBeVisible({ timeout: BOOT_TIMEOUT });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      heatmap(page).getByRole('button', { name: 'Download table' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('expression-R-HSA-109606-E-MTAB-2836.tsv');
    const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
    expect(text).toContain('# Licence: CC BY 4.0');
    const columns = text
      .split('\n')
      .find((line) => line.startsWith('Ensembl gene'))
      ?.split('\t');
    expect(columns?.length, 'five columns per tissue').toBe(
      2 + 5 * answer.experiment.tissues.length
    );
    const rows = text
      .trimEnd()
      .split('\n')
      .filter((line) => line.startsWith('ENSG'))
      .map((line) => line.split('\t'));
    expect(
      rows.map((row) => row[0]),
      'the rows in the order shown'
    ).toEqual(answer.rows.map((r) => r.gene));
    for (const [i, row] of rows.entries()) {
      const expected =
        answer.rows[i]?.values.flatMap((v) => (v ? v.map(String) : ['', '', '', '', ''])) ?? [];
      expect(row.slice(2), `${row[1]}'s values`).toEqual(expected);
    }
  });

  test('follows the theme when it is switched (FR-014)', async ({ page }) => {
    // Expression Atlas's widget kept its own background in dark mode.
    await page.addInitScript(() => localStorage.setItem('is-dark', 'false'));
    await page.goto('/PathwayBrowser/R-HSA-109606?tab=expression');
    const canvas = heatmap(page).locator('canvas');
    await expect(canvas).toBeVisible({ timeout: BOOT_TIMEOUT });
    const firstCell = () =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const ratio = window.devicePixelRatio || 1;
        return Array.from(
          c.getContext('2d')?.getImageData(5 * ratio, 5 * ratio, 1, 1).data ?? []
        ).join(',');
      });
    const light = await firstCell();
    const body = () => organFill(page, 'UBERON_0001013');
    await expect(page.locator('cr-expression-anatomogram #UBERON_0001013')).toBeAttached();
    const lightBody = await body();
    await page.locator('#dark-toggle button').click();
    await expect
      .poll(firstCell, { message: 'the cells are redrawn in the dark theme' })
      .not.toBe(light);
    await expect.poll(body, { message: 'the anatomogram is recoloured too' }).not.toBe(lightBody);
  });
});

test.describe('Illustrations', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  // An illustration is SVG and is now parsed as XML, so a file that is not
  // well-formed is refused. Refused has to mean told, not a blank panel: before,
  // anything the HTML parser could not make sense of simply drew nothing.
  test('one that cannot be drawn says so', async ({ page }) => {
    await page.route('**/ehld/R-HSA-109581.svg', (route) =>
      route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg><g></svg>' })
    );
    await page.goto('/PathwayBrowser/R-HSA-109581');
    await expect(page.locator('cr-ehld [role="alert"]')).toHaveText(
      'This illustration could not be drawn.',
      { timeout: 90_000 }
    );
    await expect(page.locator('cr-ehld #ehld svg')).toHaveCount(0);
  });

  test('one that cannot be fetched says so, once the pathway is known to have one', async ({
    page,
  }) => {
    await page.route('**/ehld/R-HSA-109581.svg', (route) => route.fulfill({ status: 404 }));
    await page.goto('/PathwayBrowser/R-HSA-109581');
    await expect(page.locator('cr-ehld [role="alert"]')).toHaveText(
      'This illustration could not be loaded.',
      { timeout: 90_000 }
    );
  });
});

test.describe('Hierarchy and illustration together', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  // Hovering a sub-pathway in the tree should light up its region in the
  // illustration, as the old browser did. The tree marked its own row and
  // told nothing else (#297).
  test('hovering a sub-pathway row lights up its region, and leaving clears it', async ({
    page,
  }) => {
    await page.goto('/PathwayBrowser/R-HSA-1640170');
    await page.waitForSelector('cr-ehld #ehld svg g[id="REGION-R-HSA-69620"]', { timeout: 90_000 });
    const region = () =>
      page.evaluate(
        () => (document.querySelector('g[id="REGION-R-HSA-69620"]') as SVGGElement).style.filter
      );
    expect(await region()).not.toContain('drop-shadow');

    const row = page.locator('.tree-node button', { hasText: 'Cell Cycle Checkpoints' }).first();
    await row.hover();
    await expect.poll(region).toContain('drop-shadow');

    await page.mouse.move(5, 5);
    await expect.poll(region).not.toContain('drop-shadow');
  });

  test('an expanded sub-pathway keeps its highlight after visiting a child row', async ({
    page,
  }) => {
    // Selecting something inside Cell Cycle Checkpoints expands its row beside
    // the illustration without selecting the row itself. Its node contains the
    // child rows, so hover bound on the node was cleared by a child's leave and
    // never set again on the way back up.
    await page.goto('/PathwayBrowser/R-HSA-1640170?select=R-HSA-69615');
    await page.waitForSelector('cr-ehld #ehld svg g[id="REGION-R-HSA-69620"]', { timeout: 90_000 });
    const region = () =>
      page.evaluate(
        () => (document.querySelector('g[id="REGION-R-HSA-69620"]') as SVGGElement).style.filter
      );
    const header = page.locator('mat-nested-tree-node[st-id="R-HSA-69620"] > .tree-node').first();
    const child = page.locator('[st-id="R-HSA-69615"] .tree-node').first();
    await expect(child).toBeVisible({ timeout: 60_000 });

    await header.hover();
    await expect.poll(region).toContain('drop-shadow');
    await child.hover();
    await header.hover();
    await expect.poll(region).toContain('drop-shadow');
  });
});

test('a link to a pathway drawn in its parent keeps the entity it selected', async ({ page }) => {
  // Its steps wait up to 90s each, longer than the global 60s.
  test.setTimeout(3 * 60 * 1000);
  // Synthesis of PIPs at the plasma membrane has no diagram of its own, so the
  // browser shows its parent's, PI Metabolism. A link that also named an entity
  // in it -- PTEN, here -- lost that selection on the way: the hand-off always
  // selected the sub-pathway instead, so the reader landed on the pathway's
  // details rather than the entity's they were sent to.
  const NO_DIAGRAM = 'R-HSA-1660499';
  const PARENT = 'R-HSA-1483255';
  const PTEN = 'R-HSA-199420';
  await page.goto(`/PathwayBrowser/${NO_DIAGRAM}?select=${PTEN}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 90_000 })
    .toBe(`/PathwayBrowser/${PARENT}`);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('select'), { timeout: 90_000 })
    .toBe(PTEN);
  await expect(page.locator('cr-description-tab').first()).toContainText(PTEN, {
    timeout: 90_000,
  });
});

test.describe('a link to a reaction', () => {
  // Each step waits up to 90s for a cold backend; the global 60s would cut a
  // slow hand-off short and report a timeout instead of the step that failed.
  test.describe.configure({ timeout: 3 * 60 * 1000 });
  // A reaction has no diagram of its own; the pathway that contains it does.
  // A link straight to one used to show the "nothing to draw" notice. It now
  // opens the parent pathway's diagram with the reaction selected in it.
  const REACTION = 'R-HSA-5672965'; // RAS GEFs promote RAS nucleotide exchange
  const PARENT = 'R-HSA-5673001'; // RAF/MAP kinase cascade
  const drawn = (page: import('@playwright/test').Page) =>
    page.waitForFunction(
      () => {
        const container = document.querySelector('#cytoscape') as
          (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
        return (container?._cyreg?.cy?.elements().length ?? 0) > 0;
      },
      { timeout: 90_000 }
    );

  test("opens its parent pathway's diagram with the reaction selected", async ({ page }) => {
    await page.goto(`/PathwayBrowser/${REACTION}`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 90_000 })
      .toBe(`/PathwayBrowser/${PARENT}`);
    expect(new URL(page.url()).searchParams.get('select')).toBe(REACTION);
    await drawn(page);
    // Selected in the drawing, not just named in the address.
    await expect
      .poll(
        () =>
          page.evaluate((stId) => {
            const container = document.querySelector('#cytoscape') as
              | (HTMLElement & {
                  _cyreg?: {
                    cy?: {
                      $(selector: string): {
                        map(f: (e: { data(k: string): unknown }) => unknown): unknown[];
                      };
                    };
                  };
                })
              | null;
            return container?._cyreg?.cy
              ?.$(':selected')
              .map((e) => e.data('graph.stId'))
              .includes(stId);
          }, REACTION),
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect(page.locator('cr-description-tab').first()).toContainText(REACTION, {
      timeout: 30_000,
    });
  });

  test('keeps an entity the link selected in it', async ({ page }) => {
    const ENTITY = 'R-HSA-109783'; // p21 RAS:GTP, drawn in the parent's diagram
    await page.goto(`/PathwayBrowser/${REACTION}?select=${ENTITY}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 90_000 })
      .toBe(`/PathwayBrowser/${PARENT}`);
    expect(new URL(page.url()).searchParams.get('select')).toBe(ENTITY);
    await drawn(page);
  });
});
