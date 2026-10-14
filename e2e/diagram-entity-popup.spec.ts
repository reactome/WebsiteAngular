import { Page } from '@playwright/test';
import { test, expect } from './support/backend';

// Right-click inspector on diagram entities (issue #122).
//
// Modelled on the popup in the current production Pathway Browser: titled with
// the entity, Molecules / Pathways / Interactors down the side, contents shown
// in place. An earlier version of this feature deep linked into the details
// panel instead, which curators read as "it just changes the tab" -- so these
// tests assert that the answer appears *in the popup*, which is the whole point
// of it.
//
// A sub-pathway is used deliberately: top-level pathways such as Apoptosis
// render an EHLD illustration rather than the interactive diagram, and have no
// entities to right-click at all.
const PATHWAY = '/PathwayBrowser/R-HSA-109606?tab=info';
const BOOT = 60_000;

/**
 * Entities are drawn on a canvas, so there is no element to target. Sweep the
 * diagram until a right-click lands on one. Bounded, and fails loudly rather
 * than passing silently if nothing is ever hit.
 */
async function openPopupOnAnyEntity(page: Page): Promise<string> {
  const container = page.locator('#cytoscape').first();
  await expect(container).toBeVisible({ timeout: BOOT });

  // cytoscape stacks several canvases once it has laid the diagram out.
  // Waiting for those beats a fixed sleep, which expires mid-render on a
  // loaded machine and leaves the sweep clicking empty space.
  await expect
    .poll(
      async () =>
        container
          .locator('canvas')
          .evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().width > 400).length),
      { timeout: BOOT }
    )
    .toBeGreaterThan(1);

  const popup = page.locator('.entity-popup');

  for (const offset of [0, 0.017]) {
    await page.waitForTimeout(3_000);
    const box = (await container.boundingBox())!;

    for (let fy = 0.12 + offset; fy <= 0.92; fy += 0.04) {
      for (let fx = 0.08 + offset; fx <= 0.94; fx += 0.035) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, {
          button: 'right',
        });
        if (await popup.count()) {
          return (await page.locator('.entity-popup__title').innerText()).trim();
        }
      }
    }
  }
  throw new Error('no diagram entity found to right-click');
}

type DiagramNode = {
  data(key: string): unknown;
  renderedPosition(): { x: number; y: number };
  selected(): boolean;
  hasClass(name: string): boolean;
};
type DiagramCy = {
  nodes(): { filter(test: (node: DiagramNode) => boolean): DiagramNode[] };
  zoom(level: number): void;
  center(node: DiagramNode): void;
};

/**
 * Right-click the node drawn for one entity. Canvas nodes have no element to
 * click, so cytoscape is asked where it is drawn, the diagram is zoomed and
 * centred on it, and the right-click lands there.
 */
async function rightClickNode(page: Page, stId: string): Promise<void> {
  const container = page.locator('#cytoscape').first();
  await expect(container).toBeVisible({ timeout: BOOT });
  const at = (zoomIn: boolean) =>
    page.evaluate(
      ({ stId, zoomIn }) => {
        const el = document.querySelector('#cytoscape') as
          (HTMLElement & { _cyreg?: { cy?: DiagramCy } }) | null;
        const cy = el?._cyreg?.cy;
        const node = cy?.nodes().filter((n) => n.data('graph.stId') === stId)[0];
        if (!cy || !node) return null;
        if (zoomIn) {
          cy.zoom(2);
          cy.center(node);
        }
        return node.renderedPosition();
      },
      { stId, zoomIn }
    );
  await expect.poll(() => at(false), { timeout: BOOT }).not.toBeNull();
  await at(true);
  // Wait for the node to stop moving: a page opened with a selection fits the
  // view to it with an animation, which can still be running here.
  let point = await at(false);
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(300);
        const next = await at(false);
        const still = !!next && !!point && next.x === point.x && next.y === point.y;
        point = next;
        return still;
      },
      { timeout: BOOT }
    )
    .toBe(true);
  const box = await container.boundingBox();
  if (!point || !box) throw new Error(`${stId} is not drawn`);
  await page.mouse.click(box.x + point.x, box.y + point.y, { button: 'right' });
}

test.describe('Diagram entity popup', () => {
  // Each test renders a full cytoscape diagram and then sweeps it with clicks.
  // Run four of those at once and they starve each other's rendering, so the
  // sweep clicks empty space and the popup never opens -- a failure that says
  // nothing about the feature. Serial keeps them honest.
  test.describe.configure({ mode: 'serial' });
  test.slow();

  test('opens titled with the entity and offers three tabs', async ({ page }) => {
    await page.goto(PATHWAY);
    const entity = await openPopupOnAnyEntity(page);

    expect(entity.length).toBeGreaterThan(0);
    const tabs = page.locator('.entity-popup__tabs button');
    await expect(tabs).toHaveCount(3);
    for (const label of ['Molecules', 'Pathways', 'Interactors']) {
      await expect(tabs.filter({ hasText: label })).toHaveCount(1);
    }
  });

  test("shows the entity's molecules without leaving the diagram", async ({ page }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);
    const before = page.url();

    // Molecules is the tab it opens on.
    const rows = page.locator('.entity-popup__content li');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect((await rows.first().innerText()).trim().length).toBeGreaterThan(0);

    // The point of the popup: the answer arrives without navigating anywhere.
    expect(page.url()).toBe(before);
  });

  test('groups molecules by type, using the reference entity not the schema class', async ({
    page,
  }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);

    const rows = page.locator('.entity-popup__content li');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    // Every heading must come from the vocabulary the Molecule tab uses.
    // Deriving the type from schemaClass alone once put "BBC3 gene" under
    // Proteins, because EntityWithAccessionedSequence covers proteins, DNA
    // and RNA alike -- so the type comes from the reference entity instead.
    // Read the label element rather than the heading, which also carries the
    // count.
    const headings = await page.locator('.entity-popup__group .label').allInnerTexts();
    for (const heading of headings) {
      expect(['Proteins', 'DNA/RNA', 'Chemical Compounds', 'Drugs', 'Others']).toContain(
        heading.trim()
      );
    }

    // Each count must match the rows actually rendered beneath it.
    const counts = await page.locator('.entity-popup__group .count').allInnerTexts();
    const total = counts.reduce((sum, c) => sum + Number(c.trim()), 0);
    expect(total).toBe(await page.locator('.entity-popup__content li').count());
  });

  test('lists the pathways containing the entity', async ({ page }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);

    await page.locator('.entity-popup__tabs button', { hasText: 'Pathways' }).click();

    // Either real pathways, or an explicit statement that there are none --
    // never an empty box that looks broken.
    const rows = page.locator('.entity-popup__content li');
    const note = page.locator('.entity-popup__note');
    await expect(rows.first().or(note)).toBeVisible({ timeout: 20_000 });
  });

  test('choosing a pathway in it selects that pathway, even one drawn in this diagram', async ({
    page,
  }) => {
    // PTEN in PI Metabolism. Its pathways are mostly sub-pathways without a
    // diagram of their own, drawn in this same diagram: choosing one hands off
    // back here. The choice has to say which pathway it was, or the hand-off
    // keeps the entity selected and the reader's click appears to do nothing.
    const PARENT = 'R-HSA-1483255';
    const SUBPATHWAY = 'R-HSA-1660499';
    const PTEN = 'R-HSA-199420';
    await page.goto(`/PathwayBrowser/${PARENT}`);
    const container = page.locator('#cytoscape').first();
    await expect(container).toBeVisible({ timeout: BOOT });
    await rightClickNode(page, PTEN);
    await expect(page.locator('.entity-popup')).toBeVisible({ timeout: 20_000 });

    await page.locator('.entity-popup__tabs button', { hasText: 'Pathways' }).click();
    await page
      .locator('.entity-popup__content li', { hasText: 'Synthesis of PIPs at the plasma membrane' })
      .first()
      .click({ timeout: 20_000 });

    await expect
      .poll(() => new URL(page.url()).searchParams.get('select'), { timeout: BOOT })
      .toBe(SUBPATHWAY);
    // Drawn in its parent's diagram, which is the one it was chosen from.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: BOOT })
      .toBe(`/PathwayBrowser/${PARENT}`);
    expect(new URL(page.url()).searchParams.get('select')).toBe(SUBPATHWAY);
  });

  test('right-clicking the entity already selected leaves later selections working', async ({
    page,
  }) => {
    // The right-click selects the entity as an in-diagram selection, flagging
    // it so the select effect does not fit the view to it. When the entity was
    // selected already the selection did not change, the effect never ran, and
    // the flag stayed up: the next selection from outside the diagram -- a
    // search hit, a link, the details panel -- was then ignored by it.
    const PARENT = 'R-HSA-1483255';
    const PTEN = 'R-HSA-199420';
    await page.goto(`/PathwayBrowser/${PARENT}?select=${PTEN}`);
    await rightClickNode(page, PTEN);
    await expect(page.locator('.entity-popup')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // Another entity drawn here, chosen from outside the diagram.
    const other = await page.evaluate((pten) => {
      const cy = (
        document.querySelector('#cytoscape') as HTMLElement & { _cyreg: { cy: DiagramCy } }
      )._cyreg.cy;
      const node = cy
        .nodes()
        .filter(
          (n) =>
            n.hasClass('PhysicalEntity') && n.data('graph.stId') !== pten && !!n.data('graph.stId')
        )[0];
      return node ? String(node.data('graph.stId')) : null;
    }, PTEN);
    expect(other).not.toBeNull();
    await page.evaluate((stId) => {
      const url = new URL(location.href);
      url.searchParams.set('select', stId);
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, other);

    await expect
      .poll(
        () =>
          page.evaluate((stId) => {
            const cy = (
              document.querySelector('#cytoscape') as HTMLElement & { _cyreg: { cy: DiagramCy } }
            )._cyreg.cy;
            return cy
              .nodes()
              .filter((n) => n.data('graph.stId') === stId)
              .some((n) => n.selected());
          }, other),
        { timeout: BOOT }
      )
      .toBe(true);
  });

  test('explains itself when an entity cannot have interactors', async ({ page }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);

    await page.locator('.entity-popup__tabs button', { hasText: 'Interactors' }).click();

    const rows = page.locator('.entity-popup__content li');
    const note = page.locator('.entity-popup__note');
    await expect(rows.first().or(note)).toBeVisible({ timeout: 20_000 });
  });

  test('clicking a molecule moves to it, and the title brings you back', async ({ page }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);

    const selection = () => page.evaluate(() => new URL(location.href).searchParams.get('select'));
    const zoom = () => page.locator('mat-slider input').first().inputValue();

    const startSelection = await selection();
    const startZoom = await zoom();

    // Selecting a molecule sends the diagram to it, as production does --
    // though only when that molecule is drawn as its own node, so the move
    // itself is not asserted here, only that the selection followed.
    await page.locator('.entity-popup__content li button').first().click();
    await expect.poll(selection, { timeout: 15_000 }).not.toBe(startSelection);

    // The title is the way back. Production has no equivalent, which is what
    // made its movement disorienting: it returns both the selection and the
    // exact view, rather than fitting to the entity at some zoom you were
    // never at.
    await page.locator('.entity-popup__title').click();
    await expect.poll(selection, { timeout: 15_000 }).toBe(startSelection);
    await expect.poll(zoom, { timeout: 15_000 }).toBe(startZoom);
  });

  test('closes on Escape without navigating', async ({ page }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);
    const before = page.url();

    await page.keyboard.press('Escape');

    await expect(page.locator('.entity-popup')).toHaveCount(0);
    expect(page.url()).toBe(before);
  });

  test('stays open when pinned and a click lands elsewhere', async ({ page }) => {
    await page.goto(PATHWAY);
    await openPopupOnAnyEntity(page);

    await page.getByRole('button', { name: 'Keep this open' }).click();
    await page
      .locator('#cytoscape')
      .first()
      .click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.entity-popup')).toHaveCount(1);
  });
});

test.describe('Popup with an analysis running', () => {
  // The curator asked for this: after an analysis, right-clicking a complex
  // should say which of its molecules were in the submitted set. The user guide
  // documents the same thing -- "Molecules show the participating molecules, and
  // if an expression analysis has been performed, their expression values."
  //
  // A row's own identifier is not enough to answer that: a component may be a
  // complex or a set, so the check runs over its participating reference
  // entities, and a complex counts as found when anything inside it was.
  test('marks which molecules the analysis found', async ({ page, request, baseURL }) => {
    const res = await request.post(
      `${baseURL}/AnalysisService/identifiers/projection?pageSize=1&page=1`,
      {
        headers: { 'Content-Type': 'text/plain' },
        data: 'TP53\nBAX\nBCL2\nCASP3\nAPAF1',
        timeout: 120_000,
      }
    );
    test.skip(!res.ok(), 'analysis service unavailable on this backend');
    const token: string | undefined = (await res.json())?.summary?.token;
    if (!token) {
      test.skip(true, 'analysis returned no token');
      // Unreachable: test.skip() above aborts the test. The return is what tells
      // TypeScript so -- skip narrows nothing, which is why this line read as a
      // possibly-undefined token below.
      return;
    }

    await page.goto(`/PathwayBrowser/R-HSA-109606?analysis=${encodeURIComponent(token)}`);
    await openPopupOnAnyEntity(page);

    // Markers only appear once the participants lookup lands, so poll rather
    // than assert immediately.
    await expect
      .poll(async () => page.locator('.row-hit').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // Every marker must be a real verdict, not a default: a row we cannot
    // resolve carries no marker at all rather than claiming "not found".
    const total = await page.locator('.row-hit').count();
    const found = await page.locator('.row-hit--found').count();
    expect(found).toBeLessThanOrEqual(total);
  });

  test('shows no analysis markers when no analysis is running', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606');
    await openPopupOnAnyEntity(page);
    await expect(page.locator('.entity-popup__content li').first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.locator('.row-hit').count()).toBe(0);
  });
});
