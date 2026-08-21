import { test, expect, type Page } from '@playwright/test';

// Contents of the panels curators read, rather than the presence of the panels.
// `release-checklist.spec.ts` already asserts the six tabs exist; these assert
// there is something in them.

const PATHWAY = 'R-HSA-109606'; // Intrinsic Pathway for Apoptosis: a real diagram
const PROTEIN = 'R-HSA-50757'; // BCL2
const REACTION = 'R-HSA-6805479'; // TP53RK phosphorylates TP53
const BOOT = 90_000;

async function openDiagram(page: Page, id = PATHWAY, query = '') {
  await page.goto(`/PathwayBrowser/${id}${query}`);
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT });
  await page.waitForTimeout(4000);
}

async function openMolecules(page: Page) {
  await page.getByText('Molecule', { exact: true }).first().click();
  await expect(page.locator('cr-molecule-tab')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
}

test.describe('Molecules tab', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('molecules are grouped, counted, and carry their stoichiometry', async ({ page }) => {
    await openDiagram(page);
    await openMolecules(page);

    const tab = page.locator('cr-molecule-tab');
    // The groups a curator scans: proteins and chemicals at least, each headed
    // with a count.
    await expect(tab).toContainText(/Proteins/);
    await expect(tab).toContainText(/Chemical Compounds/);

    const rows = tab.locator('cr-object-tree');
    expect(await rows.count(), 'molecule rows').toBeGreaterThan(20);

    // "12 ×" beside a molecule that appears twelve times. Without these the list
    // is just names and the counts per protein are gone.
    const multipliers = await tab.locator('b').allInnerTexts();
    expect(
      multipliers.filter((text) => /^\d+\s*×$/.test(text.trim())).length,
      'rows showing how many instances there are'
    ).toBeGreaterThan(5);
  });

  test('selecting an entity shades it in the list', async ({ page }) => {
    await openDiagram(page);
    await openMolecules(page);
    expect(await page.locator('cr-molecule-tab .highlight').count(), 'nothing shaded yet').toBe(0);

    // Selected while the tab is open, which is the only order that shows this:
    // arriving with ?select= already set opens the entity's own details instead
    // and the molecule list is not on offer at all.
    await page.locator('cr-search input').first().fill('BCL2');
    await page.locator('cr-search .search-icon').first().click();
    const result = page.locator('cr-search .result-row').first();
    await expect(result).toBeVisible({ timeout: 60_000 });
    await result.click();

    await expect(page.locator('cr-molecule-tab'), 'the tab stays open').toBeVisible();
    await expect(page.locator('cr-molecule-tab .highlight').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});

test.describe('Protein page', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('a protein names its experimental structure', async ({ page }) => {
    await page.goto(`/content/detail/${PROTEIN}`);

    const viewer = page.locator('cr-structure-viewer');
    await expect(viewer).toBeVisible({ timeout: BOOT });
    // The structure it found, by accession. Not the 3D render: headless Chromium
    // has no WebGL, and the viewer says so in place of drawing -- which is a
    // property of the test machine, not of the site.
    // No whitespace in the assertion: the label and the accession are separate
    // elements, so the text reads "StructurePDB5JSN".
    await expect(viewer).toContainText(/PDB/i);
    await expect(viewer).toContainText(/\d[A-Za-z0-9]{3}/);
  });
});

test.describe('Reaction page', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('every section a curator checks is present and filled', async ({ page }) => {
    await page.goto(`/content/detail/${REACTION}`);
    await page.waitForSelector('cr-reaction-diagram canvas', { timeout: BOOT });

    const detail = page.locator('.detail-container');

    // Identity: the name in the heading, the stable id and the type in the
    // overview.
    await expect(detail.getByText(/TP53RK phosphorylates TP53/).first()).toBeVisible();
    await expect(detail).toContainText(REACTION);
    await expect(detail).toContainText(/Transition Reaction|Reaction/);
    await expect(detail).toContainText(/Homo sapiens/);

    // The summation, which is the part that is prose rather than structure.
    await expect(detail).toContainText(/phosphorylates TP53 \(p53\) on serine residue S15/);

    // Participants and provenance, by their section headings.
    for (const section of [
      'Locations',
      'Reaction Diagram',
      'Inputs',
      'Outputs',
      'Catalyst Activity',
      'References',
      'Authorship',
    ]) {
      await expect(
        detail.getByText(section, { exact: true }).first(),
        `the ${section} section`
      ).toBeVisible();
    }

    // Filled, not merely present: a reaction with no inputs listed is the bug
    // this is here to catch.
    const inputs = detail.locator('[id="input"], [id="inputs"]');
    if (await inputs.count()) {
      await expect(inputs.first()).not.toBeEmpty();
    }
    // A literature reference resolves to PubMed.
    await expect(detail.locator('a[href*="pubmed"]').first()).toBeVisible();
  });
});

// One page, one renderer. The thumbnail used to come from the content service's
// diagram exporter -- which reimplements the drawing server side -- while the
// download buttons beside it went through the render service, so the picture on
// the page and the picture you downloaded were in two different styles.
test.describe('Pathway page figure', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  for (const [pathway, kind] of [
    ['R-HSA-109606', 'a cytoscape diagram'],
    ['R-HSA-109581', 'an illustration'],
  ] as const) {
    test(`${kind} is drawn by the site's own renderer`, async ({ page, request }) => {
      const health = await request.get('/RenderService/health').catch(() => null);
      test.skip(!health?.ok(), 'the render service is not running; the figure comes from it');

      await page.goto(`/content/detail/${pathway}`);
      const figure = page.locator('.detail-diagram img').first();
      await expect(figure).toBeVisible({ timeout: 120_000 });

      // Both halves: the source, so a silent fall back to the old exporter fails
      // this, and naturalWidth, so an error page with a 200 on it fails too.
      await expect
        .poll(async () => (await figure.getAttribute('src')) ?? '', { timeout: 120_000 })
        .toContain('/RenderService/render/');
      await expect
        .poll(
          async () =>
            figure.evaluate(
              (image) =>
                (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
            ),
          { timeout: 120_000 }
        )
        .toBe(true);
    });
  }
});

// "Six tabs present and populated" was asserted as presence only. The analysis
// two (Results, Expression) need an analysis to have anything in them and are
// covered in analysis-results.spec.ts; these are the four that should hold
// something for any pathway with a diagram.
test.describe('Pathway tabs', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('the tabs that do not need an analysis are populated', async ({ page }) => {
    await openDiagram(page);

    for (const [tab, holds] of [
      ['Details', /Intrinsic Pathway for Apoptosis/i],
      ['Molecule', /Proteins/i],
      ['Info', /Drag|Zoom|Hover/i],
      ['Download', /SVG|PNG|SBML/i],
    ] as const) {
      await page.getByText(tab, { exact: true }).first().click();
      await page.waitForTimeout(1500);
      // By the panel's accessible name: the analysis wizard is a mat-tab-group
      // too, so its body carries the same "active" class at the same time and a
      // class selector matches both. Scoped to the panel either way, so matching
      // the tab's own label cannot pass this.
      await expect(page.getByRole('tabpanel', { name: tab }), `the ${tab} tab`).toContainText(
        holds,
        { timeout: 60_000 }
      );
    }
  });
});
