/**
 * The interactor confidence threshold.
 *
 * `RELEASE-TESTING.md:117` — "raising the confidence threshold reduces the
 * interactors shown" — is a row a curator cannot sign off, because the control
 * did not exist here. The old browser has one, opening at 0.45
 * (`DEFAULT_SCORE` in pwp-diagram's `InteractorsContent.java`).
 *
 * Everything below counts **interactors on the diagram**. A slider that moved,
 * or a query parameter that changed, proves nothing about what the reader can
 * see — and the diagram is the thing the checklist row is about.
 *
 * Reaching them takes two steps, which is easy to get wrong: choosing a resource
 * adds only the *occurrence* badges (`InteractorOccurrences`), and the
 * interactors themselves (`Interactor`) appear when one of those is clicked.
 * Measured on R-HSA-1368108 with IntAct: 112 elements, then 121 after the
 * resource, then 143 after one occurrence was opened.
 */
import { test, expect, type Page } from '@playwright/test';

const PATHWAY = 'R-HSA-1368108'; // BMAL1:CLOCK,NPAS2 activates circadian gene expression
const BOOT_TIMEOUT = 90_000;

interface Graph {
  elements(selector?: string): { length: number };
  nodes(selector?: string): {
    length: number;
    [index: number]: GraphElement;
    filter(fn: (element: GraphElement) => boolean): { length: number };
  };
}
interface GraphElement {
  data(key?: string): unknown;
  emit(event: string): void;
  visible(): boolean;
}
type CytoscapeHost = Element & { _cyreg?: { cy?: Graph } };

/**
 * How many interactors the reader can currently see.
 *
 * Visible nodes, not every element carrying the class. The first version of this
 * counted `cy.elements('.Interactor').length`, which is 22 for eleven
 * interactions -- a node and an edge each -- and never changes, because filtering
 * hides elements rather than removing them so that dragging the control is a
 * restyle instead of a relayout. That number measured the graph's contents, not
 * the reader's view, and it is the reader's view this is about.
 */
async function drawnInteractors(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    return cy.nodes('.Interactor').filter((node) => node.visible()).length;
  });
}

/** The scores the opened occurrence actually offers, so expectations are measured. */
async function offeredScores(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    const occurrence = cy.nodes('.InteractorOccurrences')[0];
    const interactions = (occurrence?.data('interactors') ?? []) as { score?: number }[];
    return interactions.map((interaction) => interaction.score ?? -1);
  });
}

/** Open a pathway, overlay IntAct, and draw one entity's interactors. */
async function showInteractors(page: Page, query = '') {
  await page.goto(`/PathwayBrowser/${PATHWAY}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
  await page.waitForTimeout(4000);

  await page.locator('.species-interactor-container .interactor').click();
  await page.locator('cr-interactors').getByRole('button', { name: 'IntAct' }).click();
  // The overlay is a fetch and a relayout.
  await page.waitForFunction(
    () => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      return (cy?.elements('.InteractorOccurrences').length ?? 0) > 0;
    },
    { timeout: BOOT_TIMEOUT }
  );

  // Step two: the badges are not the interactors.
  await page.evaluate(() => {
    const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    cy.nodes('.InteractorOccurrences')[0].emit('tap');
  });
  await page.waitForTimeout(4000);
}

/** The control, addressed by its own element rather than by a slider's position. */
const control = (page: Page) => page.locator('cr-interactor-threshold');

// Written before the feature, and shown red against it: all three cases failed
// with `cr-interactor-threshold` at count 0, which is the whole of principle III
// -- a test never seen fail describes the fix rather than guarding it.
//
// `fixme` until the control exists, so CI stays honest rather than red. The
// commit that adds the control removes this line, and the cases must pass
// without being edited. If one needs changing to pass, it was measuring the
// wrong thing.
test.describe('The interactor confidence threshold', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('is offered only while interactors are shown', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);

    // Nothing to filter, so nothing to filter with (FR-002).
    await expect(control(page)).toHaveCount(0);

    await showInteractors(page);
    await expect(control(page)).toHaveCount(1);
  });

  test('raising it removes exactly the interactions below it', async ({ page }) => {
    await showInteractors(page);

    const scores = await offeredScores(page);
    test.skip(scores.length === 0, 'this entity offered no interactions');

    const shownAtDefault = await drawnInteractors(page);
    expect(shownAtDefault, 'interactors are drawn to begin with').toBeGreaterThan(0);

    // Measured from the data in front of us rather than from a remembered figure:
    // the count at a threshold is the number of interactions at or above it.
    const expected = (threshold: number) => scores.filter((score) => score >= threshold).length;

    await setThreshold(page, 0.6);
    expect(await drawnInteractors(page), 'at 0.6').toBe(expected(0.6));

    await setThreshold(page, 0);
    expect(await drawnInteractors(page), 'everything at zero').toBe(expected(0));
  });

  test('says so when the threshold is what is hiding them', async ({ page }) => {
    await showInteractors(page);
    await setThreshold(page, 1);

    // Distinguishable from an entity that simply has none (FR-012).
    await expect(drawnInteractors(page)).resolves.toBe(0);
    await expect(control(page)).toContainText(/threshold/i);
  });
});

/** Drive the control the way a reader would, then let the diagram settle. */
async function setThreshold(page: Page, value: number) {
  const slider = control(page).locator('input[type="range"], .mat-mdc-slider input').first();
  await slider.fill(String(value));
  await slider.dispatchEvent('change');
  await page.waitForFunction(
    (want) =>
      document.querySelector('cr-interactor-threshold')?.getAttribute('data-threshold') ===
      String(want),
    value,
    { timeout: 20_000 }
  );
  await page.waitForTimeout(1200);
}
