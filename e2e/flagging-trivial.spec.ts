import { test, expect, type Page } from '@playwright/test';

/**
 * Trivial molecules stay visible while something is flagged.
 *
 * Water and protons are drawn faintly and fade out as you zoom away, because a
 * diagram carrying hundreds of them is unreadable. Flagging turns that off: a
 * search has to be able to point at a molecule, and a molecule you cannot see
 * is not an answer.
 *
 * Curators reported the opposite — "H2O and H+ disappear with zooming out" —
 * and, separately, chemical structures drawn with no molecule underneath them,
 * which is the same fault seen from the other side: the node was hidden while a
 * different handler carried on drawing its structure.
 *
 * The cause was that the zoom handler writes an *inline* opacity, which in
 * cytoscape beats any stylesheet rule, so it silently overrode the
 * `.trivial.always-visible` rule flagging relies on. Detaching it from the zoom
 * event was not enough: `triggerZoom()` calls it directly on every restyle and
 * whenever an interactor opens.
 */

const BOOT_TIMEOUT = 60_000;
// Glycolysis: 41 trivial elements, H+ and H2O among them.
const PATHWAY = 'R-HSA-70171';
const FLAGGED = 'PKM';

/** The few cytoscape members these checks touch, so none of this needs `any`. */
interface DiagramGraph {
  zoom(level?: number): number;
  emit(event: string): void;
  elements(selector: string): {
    length: number;
    map<T>(fn: (element: { numericStyle(property: string): number }) => T): T[];
  };
  data(key: string): { update(graph: DiagramGraph): void };
}

/**
 * Cytoscape registers itself on its own container so a second `cytoscape()`
 * call cannot clobber it, and that registration is the only handle a test has.
 * The alternative is reading opacities out of canvas pixels, which cannot say
 * which element was faded.
 */
type CytoscapeHost = Element & { _cyreg?: { cy?: DiagramGraph } };

async function trivialOpacities(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const host = document.querySelector('#cytoscape') as CytoscapeHost | null;
    const cy = host?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    return [
      ...new Set(
        cy.elements('.trivial').map((element) => Number(element.numericStyle('opacity').toFixed(2)))
      ),
    ];
  });
}

async function zoomTo(page: Page, zoom: number) {
  await page.evaluate((level) => {
    const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    cy.zoom(level);
    cy.emit('zoom');
  }, zoom);
  await page.waitForTimeout(400);
}

/**
 * The trivial opacities at a zoom level, read only if the zoom is still that
 * level -- otherwise `null`, so the caller retries.
 *
 * Zooming once and reading once is a race the diagram wins on a slow machine:
 * it is still settling when the test zooms, its own `fit()` then resets the
 * zoom and re-runs the fade, and the opacity read belongs to a zoom level
 * nobody asked for.
 *
 * Reproduced exactly rather than inferred. Immediately after `zoomTo(1.5)` the
 * diagram reads zoom 1.5 and opacity [1]; forcing a `fit()` straight afterwards
 * drops it to zoom 0.113 and opacity [0] -- which is the `[0]` this spec
 * reported from CI on 2026-09-09, run 34397628182.
 *
 * An opacity is only meaningful alongside the zoom it was measured at, so the
 * zoom is checked in the same evaluate that reads it.
 */
async function opacitiesAtZoom(page: Page, zoom: number): Promise<number[] | null> {
  await zoomTo(page, zoom);
  return page.evaluate((level) => {
    const host = document.querySelector('#cytoscape') as CytoscapeHost | null;
    const cy = host?._cyreg?.cy;
    if (!cy) throw new Error('no cytoscape instance on #cytoscape');
    // The diagram moved under us; this reading describes a different zoom.
    if (Math.abs(cy.zoom() - level) > 0.001) return null;
    return [
      ...new Set(
        cy.elements('.trivial').map((element) => Number(element.numericStyle('opacity').toFixed(2)))
      ),
    ];
  }, zoom);
}

/** The flag arrives from its own request, after the diagram has drawn. */
async function waitForFlag(page: Page) {
  await page.waitForFunction(
    () => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      return cy ? cy.elements('.flag').length > 0 : false;
    },
    { timeout: BOOT_TIMEOUT }
  );
}

async function openDiagram(page: Page, query = '') {
  await page.goto(`/PathwayBrowser/${PATHWAY}${query}`);
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
  // The diagram keeps drawing after its first canvas, so wait for the elements
  // themselves rather than for a delay.
  await page.waitForFunction(
    () => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      return cy ? cy.elements('.trivial').length > 0 : false;
    },
    { timeout: BOOT_TIMEOUT }
  );
}

test.describe('Trivial molecules and flagging', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  // The only test here whose expectation depends on the zoom being the one it
  // asked for. The flagged cases below expect [1] at every zoom, so a stray
  // re-fit cannot falsify them and they read directly.
  test('fade with zoom when nothing is flagged', async ({ page }) => {
    await openDiagram(page);

    await expect
      .poll(() => opacitiesAtZoom(page, 1.5), {
        message: 'visible close up',
        timeout: 45_000,
        intervals: [250, 500, 1000, 2000],
      })
      .toEqual([1]);

    await expect
      .poll(
        async () => {
          const opacities = await opacitiesAtZoom(page, 0.14);
          // Infinity, not null, for a reading we could not take. `null < 1` is
          // true in JavaScript, so a null would describe an unmeasured diagram
          // as a faded one. Playwright's toBeLessThan happens to throw on null
          // rather than accept it -- checked -- but the test should not depend
          // on a matcher's handling of a value it was never meant to receive.
          return opacities ? Math.max(...opacities) : Number.POSITIVE_INFINITY;
        },
        {
          message: 'faint far out',
          timeout: 45_000,
          intervals: [250, 500, 1000, 2000],
        }
      )
      .toBeLessThan(1);
  });

  test('stay visible at every zoom once something is flagged', async ({ page }) => {
    await openDiagram(page, `?FLG=${FLAGGED}`);
    await waitForFlag(page);

    expect(await trivialOpacities(page), 'as the diagram loads').toEqual([1]);

    for (const zoom of [0.05, 1.4, 0.12]) {
      await zoomTo(page, zoom);
      expect(await trivialOpacities(page), `at zoom ${zoom}`).toEqual([1]);
    }
  });

  test('survive a restyle, which runs the zoom handler directly', async ({ page }) => {
    await openDiagram(page, `?FLG=${FLAGGED}`);
    await waitForFlag(page);

    // What a theme change or a loading analysis does.
    await page.evaluate(() => {
      const cy = (document.querySelector('#cytoscape') as CytoscapeHost | null)?._cyreg?.cy;
      if (!cy) throw new Error('no cytoscape instance on #cytoscape');
      cy.data('reactome').update(cy);
    });
    await page.waitForTimeout(500);

    expect(await trivialOpacities(page), 'a restyle must not fade a flagged molecule').toEqual([1]);
  });
});
