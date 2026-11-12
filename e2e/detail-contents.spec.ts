import { renderServiceAvailable, serves } from './fixtures/serves';
import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// Contents of the panels curators read, rather than the presence of the panels.
// `release-checklist.spec.ts` already asserts the six tabs exist; these assert
// there is something in them.

const PATHWAY = 'R-HSA-109606'; // Intrinsic Pathway for Apoptosis: a real diagram
const PROTEIN = 'R-HSA-50757'; // BCL2
const REACTION = 'R-HSA-6805479'; // TP53RK phosphorylates TP53
const BOOT = 90_000;

/**
 * Whether this backend serves a reaction's own diagram.
 *
 * `exporter/reaction/{id}/diagram` exists on the dev host's unreleased branch and
 * 404s on production, so in CI -- which points at production -- the canvas never
 * appears. Waiting it out cost 23 minutes of a sharded run and read as a hang, so
 * ask once and skip with a reason instead.
 */
async function servesReactionDiagram(request: import('@playwright/test').APIRequestContext) {
  return serves(request, `/ContentService/exporter/reaction/${REACTION}/diagram`);
}

async function openDiagram(page: Page, id = PATHWAY, query = '') {
  await page.goto(`/PathwayBrowser/${id}${query}`);
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT });
  await page.waitForTimeout(4000);
}

async function openMolecules(page: Page) {
  await page.getByText('Molecules', { exact: true }).first().click();
  await expect(page.locator('cr-molecule-tab')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
}

/**
 * Each group's heading says in words which number is which (FR-041): "8 / 20"
 * did not, and a group with nothing shaded said only its total.
 */
async function expectCountsInWords(page: Page) {
  const counts = await page.locator('cr-molecule-tab cr-molecule-group .count').allInnerTexts();
  expect(counts.length, 'groups').toBeGreaterThan(1);
  for (const count of counts) {
    expect(count.trim(), 'a total and how many are shaded').toMatch(
      /^\d+ · (\d+|none) highlighted$/
    );
  }
}

test.describe('Molecules tab', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  test('expanding a molecule shows its details', async ({ page }) => {
    // Expanding a row read the details' component before it was defined -- a
    // runtime import cycle through the molecule tab -- so it threw NG0919 and
    // drew nothing: the toggle turned to a minus and the list stayed as it was.
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(error.message));
    await openDiagram(page);
    await openMolecules(page);

    const row = page.locator('cr-molecule-tab cr-object-tree .mat-tree-node').first();
    await row.locator('.toggle-icon-container').click();
    const details = page.locator('cr-molecule-tab cr-object-tree-details').first();
    await expect(details, "the molecule's details open under it").toBeVisible({ timeout: 30_000 });
    // Something only ATP's loaded details carry (a cross-reference), not a
    // spinner or a notice, which would also make the panel non-empty.
    await expect(details).toContainText('ZINC000004261765');
    expect(thrown).toEqual([]);
  });

  test('a molecule keeps its whole name, and an RNA with no gene names shows its own', async ({
    page,
  }) => {
    // Names were cut at a space ("snRNA" for U2 snRNA, "carbon" for carbon
    // dioxide), and an RNA sequence with no gene names opened empty details.
    await page.goto('/PathwayBrowser/R-HSA-4839726?tab=molecule');
    const tab = page.locator('cr-molecule-tab');
    await expect(tab).toBeVisible({ timeout: BOOT });
    const row = tab.locator('cr-object-tree .mat-tree-node').filter({ hasText: 'X59360' }).first();
    await expect(row).toContainText('U2 snRNA', { timeout: 60_000 });
    await expect(tab).toContainText('carbon dioxide');

    await row.locator('.toggle-icon-container').click();
    await expect(tab.locator('cr-object-tree-details').first()).toContainText('U2 snRNA', {
      timeout: 30_000,
    });
  });

  test("in an illustration, a molecule's button finds the diagrams that draw it", async ({
    page,
  }) => {
    // Cellular responses to stimuli is drawn as an illustration: the button had
    // no shape to select, and changed the address and nothing on screen. It now
    // offers the diagrams inside the pathway that draw the molecule.
    await page.goto('/PathwayBrowser/R-HSA-8953897?tab=molecule');
    const zinc = page
      .locator('cr-molecule-tab cr-object-tree > mat-tree > mat-nested-tree-node')
      .filter({ hasText: 'zinc' })
      .first();
    const button = zinc.locator('button.select').first();
    await expect(button).toHaveAttribute('aria-label', 'Find zinc(2+) in a diagram', {
      timeout: BOOT,
    });
    await button.click();

    const choices = zinc.locator('.diagram-choice');
    await expect(choices.filter({ hasText: 'Metallothioneins bind metals' })).toBeVisible({
      timeout: 30_000,
    });
    // Only diagrams inside the open pathway: zinc is drawn in some 150 overall.
    expect(await choices.count()).toBeLessThan(20);

    await choices.filter({ hasText: 'Metallothioneins bind metals' }).click();
    await expect(page).toHaveURL(/\/PathwayBrowser\/R-HSA-5661231\?.*select=chebi:29105/);
    // The diagram opens with zinc selected, drawn rather than only addressed.
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT });
  });

  test("says so when the diagrams cannot be looked for, rather than 'not drawn'", async ({
    page,
  }) => {
    // Any failure read as "not drawn in any diagram", or as every diagram in
    // Reactome under this pathway's name. Only a 404 means none.
    await page.route('**/ContentService/data/pathways/low/diagram/entity/*/allForms*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    );
    await page.goto('/PathwayBrowser/R-HSA-8953897?tab=molecule');
    const zinc = page
      .locator('cr-molecule-tab cr-object-tree > mat-tree > mat-nested-tree-node')
      .filter({ hasText: 'zinc' })
      .first();
    const button = zinc.locator('button.select').first();
    await expect(button).toHaveAttribute('aria-label', 'Find zinc(2+) in a diagram', {
      timeout: BOOT,
    });
    await button.click();
    await expect(zinc.locator('.diagram-choices')).toContainText(
      'Could not look for the diagrams that show zinc(2+)',
      { timeout: 30_000 }
    );
    await expect(zinc.locator('.diagram-choices')).not.toContainText('is not drawn');
  });

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
    const download = page.locator('cr-molecule-tab .download-button');
    const countOf = async () => Number((await download.innerText()).match(/\d+/)?.[0]);
    const pathwayCount = await countOf();

    // A new selection inside the open pathway changes only the highlighting.
    // The tab was destroyed and built again on every selection -- its list
    // vanished behind a spinner, and the pathway's molecules were fetched
    // again -- so the same element must survive, with no spinner and no
    // second fetch.
    await page.evaluate(() => {
      const tab = document.querySelector('cr-molecule-tab') as
        (Element & { kept?: boolean }) | null;
      if (tab) tab.kept = true;
      const seen: string[] = [];
      (window as unknown as { spinnerSeen: string[] }).spinnerSeen = seen;
      new MutationObserver(() => {
        if (document.querySelector('cr-molecule-tab .spinner-container')) seen.push('spinner');
      }).observe(document.body, { childList: true, subtree: true });
    });
    const fetchedAgain: string[] = [];
    page.on('request', (request) => {
      // This pathway's own list; a selection's molecules
      // (/data/participants/{id}/referenceEntities) are fetched by design.
      if (new URL(request.url()).pathname.endsWith(`/data/participants/${PATHWAY}`)) {
        fetchedAgain.push(request.url());
      }
    });

    // Selected while the tab is open, which is the only order that shows this:
    // arriving with ?select= already set opens the entity's own details instead
    // and the molecule list is not on offer at all.
    await page.locator('cr-search input').first().fill('BCL2');
    await page.locator('cr-search .search-icon').first().click();
    const result = page.locator('cr-search .result-row').first();
    await expect(result).toBeVisible({ timeout: 60_000 });
    await result.click();

    await expect(page.locator('cr-molecule-tab'), 'the tab stays open').toBeVisible();
    // Spec 023: one molecule (the search's hit is a reference entity) is shown
    // among the pathway's, highlighted, rather than listed alone as a one-row
    // tab; the header names it, with a swatch of the shading (FR-040, FR-044).
    const header = page.locator('cr-molecule-tab .scope');
    await expect(header).toContainText(/All molecules in .*highlighted: .*BCL2/, {
      timeout: 60_000,
    });
    await expect(header.locator('.swatch'), 'a key to the shading').toBeVisible();
    await expect(page.locator('cr-molecule-tab .highlight').first()).toBeVisible();
    expect(await countOf(), 'the whole pathway').toBe(pathwayCount);
    expect(
      await header.getByRole('button', { name: /Show (only|all)/ }).count(),
      'no way to a one-row list'
    ).toBe(0);
    await expectCountsInWords(page);
    expect(
      await page.evaluate(
        () =>
          (document.querySelector('cr-molecule-tab') as (Element & { kept?: boolean }) | null)
            ?.kept === true
      ),
      'the same tab, not one built again'
    ).toBe(true);
    expect(
      await page.evaluate(() => (window as unknown as { spinnerSeen: string[] }).spinnerSeen),
      'no spinner'
    ).toEqual([]);
    expect(fetchedAgain, 'the molecule list is not fetched again').toEqual([]);
  });

  test('a selection inside the pathway lists its own molecules', async ({ page }) => {
    // BAD:BCL-2, a complex of two proteins in the pathway.
    await openDiagram(page, PATHWAY, '?select=R-HSA-114268&tab=molecule');
    const tab = page.locator('cr-molecule-tab');
    await expect(tab).toBeVisible({ timeout: 60_000 });
    // Its own molecules, named in the header, unshaded: they are all the
    // selection. The download says how many it writes (FR-044, FR-048).
    const header = tab.locator('.scope');
    await expect(header).toContainText(/Molecules in .*BAD:BCL-2/, { timeout: 60_000 });
    const download = tab.locator('.download-button');
    await expect(download).toContainText('Download 2 molecules');
    expect(await tab.locator('.highlight').count(), 'none shaded').toBe(0);

    // The whole pathway is a click away, with the selection's molecules shaded,
    // the shading keyed in the header, and each group's count in words.
    await header.getByRole('button', { name: /Show all molecules in/ }).click();
    await expect(tab.locator('.highlight')).toHaveCount(2);
    await expect(header.locator('.swatch'), 'a key to the shading').toBeVisible();
    await expect(download).not.toContainText('Download 2 molecules');
    await expectCountsInWords(page);

    // Another selection: the list on screen stays until the new one's molecules
    // are in (FR-047). It showed the whole pathway, unshaded, under the new
    // selection's name for as long as the selection took to load, and a
    // download then wrote that into a file named for the selection.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { unshadedPathway: string[] }).unshadedPathway = seen;
      new MutationObserver(() => {
        const tab = document.querySelector('cr-molecule-tab');
        const rows = tab?.querySelectorAll('cr-object-tree').length ?? 0;
        if (rows > 2 && !tab?.querySelector('.highlight')) seen.push(`${rows} rows, none shaded`);
      }).observe(document.body, { childList: true, subtree: true, attributes: true });
    });
    await page.locator('cr-search input').first().fill('BCL2');
    await page.locator('cr-search .search-icon').first().click();
    const result = page.locator('cr-search .result-row').first();
    await expect(result).toBeVisible({ timeout: 60_000 });
    await result.click();
    await expect(header).toContainText(/highlighted: .*BCL2/, { timeout: 60_000 });
    await expect(tab.locator('.highlight').first()).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { unshadedPathway: string[] }).unshadedPathway
      ),
      'the whole pathway never shown unshaded on the way'
    ).toEqual([]);
  });
});

test.describe('Protein page', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  test('a protein names its experimental structure', async ({ page }) => {
    await page.goto(`/content/detail/${PROTEIN}`);

    const viewer = page.locator('cr-structure-viewer');
    await expect(viewer).toBeVisible({ timeout: BOOT });
    // The structure it found, by accession. Either source counts: the PDB ids
    // come from the entity's cross-references while the AlphaFold model comes
    // from its own endpoint, so which one is selected depends on what has
    // resolved -- this page has shown both. Whether an experimental structure
    // should be preferred over a predicted one is a question for the curators,
    // not something to pin here.
    //
    // Not the 3D render: headless Chromium has no WebGL and the viewer says so
    // in place of drawing, which is a property of the test machine.
    await expect(viewer).toContainText(/PDB|AlphaFold/i);
    // An accession, not just a heading: 4-character PDB codes like 5JSN, or an
    // AlphaFold model id. The label and the accession are separate elements, so
    // an assertion with whitespace in it would never match.
    await expect(viewer).toContainText(/(\d[A-Za-z0-9]{3}|AF-[A-Z0-9]+)/);
  });
});

test.describe('Reaction page', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  test('every section a curator checks is present and filled', async ({ page, request }) => {
    test.skip(
      !(await servesReactionDiagram(request)),
      'this backend does not serve a reaction its own diagram'
    );
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
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  for (const [pathway, kind] of [
    ['R-HSA-109606', 'a cytoscape diagram'],
    ['R-HSA-109581', 'an illustration'],
  ] as const) {
    test(`${kind} is drawn by the site's own renderer`, async ({ page, request }) => {
      test.skip(
        !(await renderServiceAvailable(request)),
        'the render service is not running; the figure comes from it'
      );

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
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  test('the tabs that do not need an analysis are populated', async ({ page }) => {
    await openDiagram(page);

    for (const [tab, holds] of [
      ['Details', /Intrinsic Pathway for Apoptosis/i],
      ['Molecules', /Proteins/i],
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

// The framed box around the reaction diagram had its right border clipped: the
// container is width:100% with a 1px border, and without border-box that box
// came out 2px wider than its column, which an ancestor with overflow-x:auto
// then cut off. Two pixels, so it read as "the border is missing on one side"
// rather than as a layout bug.
test.describe('Reaction diagram frame', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  for (const width of [1500, 1100]) {
    test(`the framed diagram fits its column at ${width}px`, async ({ page, request }) => {
      test.skip(
        !(await servesReactionDiagram(request)),
        'this backend does not serve a reaction its own diagram'
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/content/detail/${REACTION}`);
      await page.waitForSelector('cr-reaction-diagram canvas', { timeout: 90_000 });
      await page.waitForTimeout(2500);

      const fit = await page.evaluate(() => {
        const box = document.querySelector('cr-reaction-diagram .reaction-diagram-container');
        const host = box?.closest('cr-reaction-diagram');
        if (!box || !host) return null;
        return {
          overflow: host.scrollWidth - host.clientWidth,
          past: Math.round(box.getBoundingClientRect().right - host.getBoundingClientRect().right),
        };
      });

      // Defaults that fail rather than assertions that throw: no box means the
      // diagram is not laid out, which is a failure worth reading as one.
      const { overflow, past } = fit ?? { overflow: Infinity, past: Infinity };
      expect(overflow, 'the frame overflows its column').toBeLessThanOrEqual(0);
      expect(past, 'the frame reaches past its column').toBeLessThanOrEqual(0);
    });
  }
});

test.describe('Details overview', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  // Events carry a GO biological process and the old browser showed it; this
  // panel never did. Hemostasis is annotated to blood coagulation.
  test("shows an event's GO biological process, linked to the term", async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109582?tab=details');
    const overview = page.locator('cr-description-overview').first();
    await expect(overview).toContainText('R-HSA-109582', { timeout: BOOT });

    const row = overview.locator('.row').filter({ hasText: 'GO biological process' });
    await expect(row).toContainText('blood coagulation (GO:0007596)');
    await expect(row.locator('a')).toHaveAttribute('href', /QuickGO\/term\/GO:0007596/);
  });

  test('has no GO row for an event without one', async ({ page }) => {
    // TP53RK phosphorylates TP53 has no GO biological process.
    await page.goto(`/PathwayBrowser/R-HSA-6804756?select=${REACTION}&tab=details`);
    const overview = page.locator('cr-description-overview').first();
    await expect(overview).toContainText(REACTION, { timeout: BOOT });
    await expect(overview).not.toContainText('GO biological process');
  });
});

test.describe('Computationally predicted events', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  // Human events carry the events Reactome predicted from them in other
  // species, and the old browser listed them. This one never did: its
  // Inferences section keys on a property only physical entities have.
  test('a human event lists its predictions, by species', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109582?tab=details');
    await expect(page.locator('#orthologousEvent')).toContainText(
      'Computationally predicted events',
      {
        timeout: BOOT,
      }
    );
    const section = page.locator('.orthologous-events');
    await expect(section).toContainText('Mus musculus');
    await expect(section.locator('a[href$="/R-MMU-109582"]')).toBeAttached();
  });

  test("a curator's inference from another species is not called a prediction", async ({
    page,
  }) => {
    // Inferred from rat by a curator (isInferred, no electronic evidence).
    await page.goto('/PathwayBrowser/R-HSA-9613829?select=R-HSA-9626034&tab=details');
    const overview = page.locator('cr-description-overview').first();
    await expect(overview).toContainText('R-HSA-9626034', { timeout: BOOT });
    await expect(overview).not.toContainText('Computationally inferred');
  });

  test('a predicted event says it is one', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-MMU-1640170?tab=details');
    const overview = page.locator('cr-description-overview').first();
    await expect(overview).toContainText('R-MMU-1640170', { timeout: BOOT });
    await expect(overview.locator('.row').filter({ hasText: 'Evidence' })).toContainText(
      'Computationally inferred'
    );
  });
});
