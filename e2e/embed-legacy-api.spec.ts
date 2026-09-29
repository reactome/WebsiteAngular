import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';
import { HOST_PAGE_PORT } from './support/embed-ports';

/**
 * The old widget's interface, window.Reactome.Diagram, on a page written for
 * it (spec 009, Story 3; contracts/legacy-widget-api.md). alliance.html is
 * AllianceGenome's pathwayWidget pattern with only the script's address
 * changed: if this passes, their integration switches by that change alone.
 *
 * The argument shapes the handlers get are unit-tested against the old
 * widget's documentation in the loader's own spec; here each method and
 * handler is shown doing its job on a live diagram.
 */

const PAGE = `http://localhost:${HOST_PAGE_PORT}/alliance.html`;
const LOAD = 90_000;
// Drawn in R-HSA-69620: CDKN1A,CDKN1B, a DefinedSet.
const ENTITY = 'R-HSA-182558';
const FLAG = 'CHEK1';
// An existing result, read only: nothing is submitted.
const TOKEN = 'MjAyNjA5MjUxNDM3NThfMTM=';

type Widget = Record<string, (...args: unknown[]) => void>;
type LegacyGlobals = {
  __legacy: [string, unknown?][];
  __polls: number;
  widget: Widget;
};

/** Everything the old handlers have been called with, in order. */
const legacy = (page: Page) => page.evaluate(() => (window as unknown as LegacyGlobals).__legacy);

/** Calls a method on the widget, as the partner's code would. */
const call = (page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(
    ([method, args]) =>
      (window as unknown as LegacyGlobals).widget[method as string](...(args as unknown[])),
    [method, args] as const
  );

/** The widget's drawn diagram, or null until there is one. */
const cyExpression = `document.querySelector('#reactomePathwayHolder reactome-diagram')
  ?.shadowRoot?.querySelector('reactome-diagram-view')?.shadowRoot
  ?.querySelector('#cytoscape')?._cyreg?.cy`;
const count = (page: Page, selector: string) =>
  page.evaluate<number>(
    `(() => { const cy = ${cyExpression}; return cy ? cy.elements(${JSON.stringify(selector)}).length : 0; })()`
  );

async function loaded(page: Page, stId = 'R-HSA-69620') {
  await expect
    .poll(
      async () => (await legacy(page)).filter(([t, d]) => t === 'loaded' && d === stId).length,
      {
        timeout: LOAD,
      }
    )
    .toBeGreaterThan(0);
}

/** Page coordinates of a node in view that has a stable id. */
async function aNode(page: Page) {
  return page.evaluate<{ x: number; y: number; stId: string }>(`(() => {
    const c = document.querySelector('#reactomePathwayHolder reactome-diagram').shadowRoot
      .querySelector('reactome-diagram-view').shadowRoot.querySelector('#cytoscape');
    const cy = c._cyreg.cy, box = c.getBoundingClientRect();
    const [n] = cy.nodes('.PhysicalEntity').filter((n) => {
      const p = n.renderedPosition();
      return p.x > 60 && p.y > 60 && p.x < box.width - 200 && p.y < box.height - 120 && n.data('graph.stId');
    });
    const p = n.renderedPosition();
    return { x: box.left + p.x, y: box.top + p.y, stId: n.data('graph.stId') };
  })()`);
}

test.describe('Reactome.Diagram, the old widget interface', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('works on a page written for the old widget, found on its first poll', async ({ page }) => {
    await page.goto(PAGE);
    await loaded(page);
    // Defined as the script ran, so the first poll, a second in, found it.
    expect(await page.evaluate(() => (window as unknown as LegacyGlobals).__polls)).toBe(1);
    const box = await page.locator('#reactomePathwayHolder reactome-diagram').boundingBox();
    expect(box && [Math.round(box.width), Math.round(box.height)]).toEqual([1130, 600]);
  });

  test('loadDiagram switches the pathway, and onDiagramLoaded says so', async ({ page }) => {
    await page.goto(PAGE);
    await loaded(page);
    await page.locator('#pathways').selectOption('R-HSA-1257604');
    await loaded(page, 'R-HSA-1257604');
    expect((await legacy(page)).filter(([t]) => t === 'loaded')).toEqual([
      ['loaded', 'R-HSA-69620'],
      ['loaded', 'R-HSA-1257604'],
    ]);
  });

  test('starts the documented way, and applies everything called before it was ready', async ({
    page,
  }) => {
    // onReactomeDiagramReady, as the old widget's documentation has it, and in
    // it every call made before the diagram's code has defined the element.
    await page.goto(`http://localhost:${HOST_PAGE_PORT}/ready.html`);
    await loaded(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { __definedAtCreate: boolean }).__definedAtCreate
      )
    ).toBe(false);
    const counts = (selector: string) =>
      page.evaluate<number>(
        `(() => { const cy = document.querySelector('#diagramHolder reactome-diagram')?.shadowRoot?.querySelector('reactome-diagram-view')?.shadowRoot?.querySelector('#cytoscape')?._cyreg?.cy; return cy ? cy.elements(${JSON.stringify(selector)}).length : 0; })()`
      );
    await expect.poll(() => counts(':selected'), { timeout: LOAD }).toBeGreaterThan(0);
    await expect.poll(() => counts('.flag'), { timeout: LOAD }).toBeGreaterThan(0);
    await expect.poll(() => counts('.hierarchy-hover'), { timeout: LOAD }).toBeGreaterThan(0);
  });

  test('applies calls made before the diagram is ready, in order', async ({ page }) => {
    // Straight after create, as a page does: all queued, none lost.
    await page.goto(PAGE);
    await page.waitForFunction(
      () => typeof (window as unknown as LegacyGlobals).widget === 'object'
    );
    await call(page, 'resetFlaggedItems');
    await call(page, 'flagItems', FLAG);
    await call(page, 'selectItem', ENTITY);
    await loaded(page);
    await expect.poll(() => count(page, '.flag'), { timeout: LOAD }).toBeGreaterThan(0);
    await expect.poll(() => count(page, ':selected'), { timeout: LOAD }).toBeGreaterThan(0);
  });

  test('selectItem selects, and resetSelection clears it', async ({ page }) => {
    await page.goto(PAGE);
    await loaded(page);
    await call(page, 'selectItem', ENTITY);
    await expect.poll(() => count(page, ':selected'), { timeout: LOAD }).toBeGreaterThan(0);
    await call(page, 'resetSelection');
    await expect.poll(() => count(page, ':selected')).toBe(0);
  });

  test('flagItems flags, and resetFlaggedItems clears it and calls onFlagsReset', async ({
    page,
  }) => {
    await page.goto(PAGE);
    await loaded(page);
    await call(page, 'flagItems', FLAG);
    await expect.poll(() => count(page, '.flag'), { timeout: LOAD }).toBeGreaterThan(0);
    await call(page, 'resetFlaggedItems');
    await expect.poll(() => count(page, '.flag')).toBe(0);
    await expect
      .poll(async () => (await legacy(page)).filter(([t]) => t === 'flagsReset').length)
      .toBe(1);
  });

  test('highlightItem makes an entity stand out without selecting it; resetHighlight clears it', async ({
    page,
  }) => {
    await page.goto(PAGE);
    await loaded(page);
    await call(page, 'highlightItem', ENTITY);
    await expect.poll(() => count(page, '.hierarchy-hover'), { timeout: LOAD }).toBeGreaterThan(0);
    expect(await count(page, ':selected')).toBe(0);
    await call(page, 'resetHighlight');
    await expect.poll(() => count(page, '.hierarchy-hover')).toBe(0);
  });

  test('setAnalysisToken overlays a result; resetAnalysis clears it and calls onAnalysisReset', async ({
    page,
  }) => {
    await page.goto(PAGE);
    await loaded(page);
    await call(page, 'setAnalysisToken', TOKEN, { resource: 'TOTAL' });
    const analysed = () =>
      page.evaluate<number>(
        `(() => { const cy = ${cyExpression}; return cy ? cy.nodes().filter((n) => n.data('exp') !== undefined).length : 0; })()`
      );
    await expect.poll(analysed, { timeout: LOAD }).toBeGreaterThan(0);
    await call(page, 'resetAnalysis');
    await expect.poll(analysed).toBe(0);
    await expect
      .poll(async () => (await legacy(page)).filter(([t]) => t === 'analysisReset').length)
      .toBe(1);
  });

  test('resize changes the diagram to the size asked for', async ({ page }) => {
    await page.goto(PAGE);
    await loaded(page);
    await call(page, 'resize', 700, 400);
    await expect
      .poll(async () => {
        const box = await page.locator('#reactomePathwayHolder reactome-diagram').boundingBox();
        return box && [Math.round(box.width), Math.round(box.height)];
      })
      .toEqual([700, 400]);
  });

  test('onObjectSelected gets the old widget object, and null on deselect', async ({ page }) => {
    await page.goto(PAGE);
    await loaded(page);
    await page.waitForTimeout(1500);
    const node = await aNode(page);
    await page.mouse.click(node.x, node.y);
    await expect
      .poll(async () => (await legacy(page)).filter(([t]) => t === 'selected').map(([, d]) => d))
      .toEqual([
        expect.objectContaining({
          stId: node.stId,
          displayName: expect.any(String),
          schemaClass: expect.any(String),
        }),
      ]);
    const holder = await page.locator('#reactomePathwayHolder reactome-diagram').boundingBox();
    if (!holder) throw new Error('no diagram box');
    await page.mouse.click(holder.x + holder.width / 2, holder.y + 6);
    await expect
      .poll(async () => (await legacy(page)).filter(([t]) => t === 'selected').at(-1)?.[1])
      .toBeNull();
  });

  test('onObjectHovered gets the old widget object', async ({ page }) => {
    await page.goto(PAGE);
    await loaded(page);
    await page.waitForTimeout(1500);
    const node = await aNode(page);
    await page.mouse.move(node.x, node.y);
    await expect
      .poll(async () =>
        (await legacy(page))
          .filter(([t]) => t === 'hovered')
          .map(([, d]) => (d as { stId?: string } | null)?.stId)
      )
      .toContain(node.stId);
  });
});
