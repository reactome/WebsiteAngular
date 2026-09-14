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
  elements(selector?: string): {
    length: number;
    filter(fn: (element: GraphElement) => boolean): { length: number };
  };
  zoom(level?: number): number;
  emit(event: string): void;
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

  test('is offered only while interactors are drawn', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);

    // No overlay, so nothing to filter and nothing to filter with (FR-002).
    await expect(control(page)).toHaveCount(0);

    // Choosing a resource is not enough: that draws the count badges, and there
    // is still nothing to filter.
    //
    // This requirement has moved twice, and both moves were the badge's doing.
    // It was first tied to drawn interactors, then to the chosen resource --
    // because a badge was the only route to the control and a badge is six
    // pixels at the zoom a pathway opens at. Now that badges are not drawn below
    // 0.6 at all, a reader who can click one can see one, so the control can
    // belong to the interactors again, and the bar can be dismissed with them.
    await page.locator('.species-interactor-container .interactor').click();
    await page.locator('cr-interactors').getByRole('button', { name: 'IntAct' }).click();
    await page.waitForTimeout(6000);
    await expect(control(page)).toHaveCount(0);

    await showInteractors(page);
    await expect(control(page)).toHaveCount(1);
  });

  test('goes away with the interactors it describes', async ({ page }) => {
    await showInteractors(page);
    await expect(control(page)).toHaveCount(1);

    await control(page).locator('.threshold-close').click();
    await expect(control(page)).toHaveCount(0);
    expect(await drawnInteractors(page), 'and takes them with it').toBe(0);
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

/**
 * The count badge is not drawn when it cannot be read.
 *
 * It is 30 model units wide, so at the 0.203 a pathway opens at it is six screen
 * pixels holding a two-digit number. The old browser does not draw it either
 * below its own threshold -- `RendererManager.setFactor` swaps renderer tiers at
 * 0.5, and `ProteinRenderer000` never calls `drawSummaryItems`.
 *
 * Asserted on what is visible rather than on the zoom, because the zoom is the
 * input and the reader's view is the thing in question.
 */
test.describe('The interactor count badge', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('appears only once it is big enough to read', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);
    await page.locator('.species-interactor-container .interactor').click();
    await page.locator('cr-interactors').getByRole('button', { name: 'IntAct' }).click();
    await page.waitForFunction(
      () => {
        const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
        return (cy?.elements('.InteractorOccurrences').length ?? 0) > 0;
      },
      { timeout: BOOT_TIMEOUT }
    );

    const visibleBadgesAt = async (zoom: number) => {
      const counts = await page.evaluate((level) => {
        const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
        if (!cy) throw new Error('no cytoscape instance on #cytoscape');
        cy.zoom(level);
        cy.emit('zoom');
        const badges = cy.elements('.InteractorOccurrences');
        return {
          total: badges.length,
          visible: badges.filter((badge) => badge.visible()).length,
        };
      }, zoom);
      await page.waitForTimeout(700);
      return counts;
    };

    // The state they arrive in, before the zoom is touched at all. This is the
    // case that matters and the one the first version of this test missed: it
    // moved the zoom before looking, which ran the handler and hid the badges, so
    // it passed while beta showed all nine at the zoom a pathway opens at.
    const onArrival = await page.evaluate(() => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      if (!cy) throw new Error('no cytoscape instance on #cytoscape');
      const badges = cy.elements('.InteractorOccurrences');
      return {
        zoom: cy.zoom(),
        total: badges.length,
        visible: badges.filter((badge) => badge.visible()).length,
      };
    });
    expect(onArrival.total, 'the badges are on the graph').toBeGreaterThan(0);
    if (onArrival.zoom < 0.6) {
      expect(onArrival.visible, 'and none is drawn at the zoom the pathway opened at').toBe(0);
    }

    const wideOut = await visibleBadgesAt(0.3);
    expect(wideOut.total, 'the badges are on the graph').toBeGreaterThan(0);
    expect(wideOut.visible, 'but none is drawn at a zoom where it cannot be read').toBe(0);

    const closeIn = await visibleBadgesAt(0.8);
    expect(closeIn.visible, 'and every one is drawn once it can be').toBe(closeIn.total);
  });
});
