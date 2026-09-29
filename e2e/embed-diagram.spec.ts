import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';
import { EMBED_PORT, HOST_PAGE_PORT } from './support/embed-ports';

/**
 * The embeddable diagram, `<reactome-diagram>`, on a page as a partner would
 * put it there: the page on one origin, the diagram's code on another, and its
 * data on a third (spec 009). Everything the element promises in
 * specs/009-embeddable-diagram/contracts/reactome-diagram-element.md is checked
 * by what happens on the page, not by what the element reports about itself.
 */

const HOST = `http://localhost:${HOST_PAGE_PORT}`;
const EMBED = `http://localhost:${EMBED_PORT}/`;
const DATA = 'http://localhost:4330';
const LOAD = 90_000;

type Cy = {
  nodes(sel?: string): { length: number; filter(f: (n: CyNode) => boolean): CyNode[] };
  $(sel: string): { map(f: (n: CyNode) => string): string[] };
  zoom(): number;
  pan(): { x: number; y: number };
};
type EmbedGlobals = {
  __events: [string, string, unknown][];
  __cy(id: string): { cy: Cy; box: DOMRect };
  __el(id: string): HTMLElement;
  __held?: HTMLElement;
  __baseline?: Record<string, unknown>;
};

type CyNode = {
  id(): string;
  renderedPosition(): { x: number; y: number };
  data(k: string): unknown;
};

/** Record the element's events from the start, before any listener could miss them. */
async function recordEvents(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as EmbedGlobals;
    w.__events = [];
    // An element's drawn diagram, reached through its view's shadow root.
    w.__cy = (id: string) => {
      const c = document
        .getElementById(id)
        ?.querySelector('reactome-diagram-view')
        ?.shadowRoot?.querySelector<HTMLElement & { _cyreg?: { cy: Cy } }>('#cytoscape');
      const cy = c?._cyreg?.cy;
      if (!c || !cy) throw new Error(`no drawn diagram in #${id}`);
      return { cy, box: c.getBoundingClientRect() };
    };
    w.__el = (id: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`no #${id} on the page`);
      return el;
    };
    for (const type of ['diagramloaded', 'diagramerror', 'entityselected', 'entityhovered']) {
      document.addEventListener(type, (e) =>
        w.__events.push([type, (e.target as HTMLElement).id, (e as CustomEvent).detail])
      );
    }
  });
}

async function events(page: Page, type?: string) {
  const all = await page.evaluate(
    () => (window as unknown as { __events: [string, string, unknown][] }).__events
  );
  return type ? all.filter(([t]) => t === type) : all;
}

async function boxOf(page: Page, id = 'diagram') {
  const box = await page.locator(`#${id}`).boundingBox();
  if (!box) throw new Error(`#${id} has no box`);
  return box;
}

/** Wait for an element's diagram to be drawn, and return how many nodes it has. */
async function drawn(page: Page, id = 'diagram'): Promise<number> {
  await expect
    .poll(async () => (await events(page, 'diagramloaded')).filter(([, el]) => el === id).length, {
      timeout: LOAD,
    })
    .toBeGreaterThan(0);
  return page.evaluate((id) => {
    const c = document
      .getElementById(id)
      ?.querySelector('reactome-diagram-view')
      ?.shadowRoot?.querySelector('#cytoscape') as
      (HTMLElement & { _cyreg?: { cy: { nodes(): { length: number } } } }) | null;
    return c?._cyreg?.cy.nodes().length ?? 0;
  }, id);
}

/**
 * Page coordinates of two distinct, clickable nodes in an element's diagram, and
 * the ids a click on each should select.
 */
async function twoNodes(page: Page, id = 'diagram') {
  return page.evaluate((id) => {
    const { cy, box } = (window as unknown as EmbedGlobals).__cy(id);
    const inView = (n: CyNode) => {
      const p = n.renderedPosition();
      return p.x > 40 && p.y > 40 && p.x < box.width - 200 && p.y < box.height - 120;
    };
    const nodes = cy
      .nodes('.PhysicalEntity')
      .filter((n: CyNode) => inView(n) && Boolean(n.data('displayName')));
    if (nodes.length < 2) throw new Error(`only ${nodes.length} nodes in view in #${id}`);
    const at = (n: CyNode) => ({
      id: n.id(),
      x: box.left + n.renderedPosition().x,
      y: box.top + n.renderedPosition().y,
    });
    return [at(nodes[0]), at(nodes[Math.floor(nodes.length / 2)])];
  }, id);
}

async function selectedIds(page: Page, id = 'diagram') {
  return page.evaluate(
    (id) =>
      (window as unknown as EmbedGlobals)
        .__cy(id)
        .cy.$(':selected')
        .map((n) => n.id()),
    id
  );
}

/**
 * The host page as it was before any script on it ran -- a snapshot taken after
 * load would already include whatever the diagram did while loading.
 */
async function recordHostBaseline(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __baseline: Record<string, unknown> };
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        w.__baseline = {
          href: location.href,
          history: history.length,
          title: document.title,
          scrollY: Math.round(window.scrollY),
          storage: Object.keys(localStorage).sort().join(','),
          bodyClass: document.body.className,
          bodyStyle: document.body.style.cssText,
        };
      },
      { once: true, capture: true }
    );
  });
}

/** Whatever of the host page the diagram must leave exactly as it found it. */
async function hostState(page: Page) {
  return page.evaluate(() => ({
    href: location.href,
    history: history.length,
    title: document.title,
    scrollY: Math.round(window.scrollY),
    storage: Object.keys(localStorage).sort().join(','),
    bodyClass: document.body.className,
    bodyStyle: document.body.style.cssText,
  }));
}

test.describe('the embeddable diagram', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test.beforeEach(async ({ page }) => {
    await recordEvents(page);
  });

  // Constitution I: a check that passes on the wrong setup proves nothing. The
  // page, the embed and the data must be three different origins, or none of
  // what follows is about a partner's page.
  test('runs on a page of another origin than its code and its data', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (r) => r.resourceType() === 'script' && scripts.push(r.url()));
    await page.goto(`${HOST}/`);
    await drawn(page);
    const origins = new Set([new URL(page.url()).origin, new URL(EMBED).origin, DATA]);
    expect(origins.size, 'three distinct origins').toBe(3);
    expect(
      scripts.some((u) => u.startsWith(EMBED)),
      'its code came from the embed origin'
    ).toBe(true);
  });

  test('draws, and responds to zoom, pan and select', async ({ page }) => {
    await page.goto(`${HOST}/`);
    expect(await drawn(page), 'nodes drawn').toBeGreaterThan(20);
    expect((await events(page, 'diagramloaded'))[0][2]).toEqual({ pathway: 'R-HSA-69620' });

    const cy = () =>
      page.evaluate(() => {
        const { cy } = (window as unknown as EmbedGlobals).__cy('diagram');
        return { zoom: cy.zoom(), pan: { ...cy.pan() } };
      });
    const box = await boxOf(page);

    // Select while the whole diagram is in view; zoom and pan move nodes off it.
    const [node] = await twoNodes(page);
    await page.mouse.click(node.x, node.y);
    await expect.poll(() => selectedIds(page)).toEqual([node.id]);

    const before = await cy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await cy()).zoom).not.toBe(before.zoom);

    const pan = (await cy()).pan;
    // Drag from an empty corner: a node there would be dragged, not the view.
    await page.mouse.move(box.x + 30, box.y + box.height - 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + box.height - 80, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await cy()).pan).not.toEqual(pan);
  });

  // The spike found this (research R5): cytoscape clears its cached position on
  // ancestors' scroll events, found by walking parentNode, which stops at the
  // shadow root. After the page scrolled, a click landed where the diagram had
  // been and selected nothing.
  test('selects what is clicked after the host page has scrolled', async ({ page }) => {
    await page.goto(`${HOST}/`);
    await drawn(page);
    const [first] = await twoNodes(page);
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => selectedIds(page)).toEqual([first.id]);

    // Two scrolls, then a node other than the first: a single short scroll
    // happened to leave the click on target in a probe of the unfixed build,
    // while 320px missed.
    for (const dy of [120, 200]) {
      await page.evaluate((dy) => window.scrollBy(0, dy), dy);
      await page.waitForTimeout(300);
    }
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the page did scroll').toBe(320);
    const [, second] = await twoNodes(page);
    expect(second.id, 'a different node').not.toBe(first.id);
    await page.mouse.click(second.x, second.y);
    await expect.poll(() => selectedIds(page)).toEqual([second.id]);
  });

  test('leaves the host page alone', async ({ page }) => {
    await recordHostBaseline(page);
    await page.goto(`${HOST}/`);
    await drawn(page);
    const before = await page.evaluate(
      () => (window as unknown as { __baseline: Record<string, unknown> }).__baseline
    );
    expect(await hostState(page), 'nothing changed while the diagram loaded').toEqual(before);

    const box = await boxOf(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    const [node] = await twoNodes(page);
    await page.mouse.click(node.x, node.y);
    await expect.poll(() => selectedIds(page)).toEqual([node.id]);
    // The wheel over the diagram zooms it; it must not scroll the page.
    expect(await hostState(page)).toEqual(before);
  });

  test("keeps its styles and the host's apart", async ({ page }) => {
    const shot = async (url: string) => {
      await page.goto(url);
      await drawn(page);
      await page.waitForTimeout(1500); // cytoscape finishes drawing a frame after the event
      return page.locator('#diagram').screenshot();
    };
    // plain.html is hostile.html without its stylesheet: the same layout, so
    // any difference is the styles reaching in.
    const plain = await shot(`${HOST}/plain.html`);
    const hostile = await shot(`${HOST}/hostile.html`);
    // Not one pixel of the diagram changes under a stylesheet aimed at everything.
    expect(hostile.equals(plain), 'the diagram under hostile page styles').toBe(true);

    // And nothing of ours reaches out: the partner's own heading keeps its look.
    await page.goto(`${HOST}/`);
    const colour = () =>
      page
        .locator('h1')
        .evaluate((h) => getComputedStyle(h).color + getComputedStyle(h).fontFamily);
    const beforeLoad = await colour();
    await drawn(page);
    expect(await colour()).toBe(beforeLoad);
  });

  test('two diagrams on one page are independent', async ({ page }) => {
    await page.goto(`${HOST}/two.html`);
    await drawn(page, 'first');
    await drawn(page, 'second');
    const [node] = await twoNodes(page, 'first');
    await page.mouse.click(node.x, node.y);
    await expect.poll(() => selectedIds(page, 'first')).toEqual([node.id]);
    expect(
      await selectedIds(page, 'second'),
      'selecting in one does not select in the other'
    ).toEqual([]);
    const loaded = (await events(page, 'diagramloaded')).map(([, el, d]) => [el, d]);
    expect(loaded).toEqual(
      expect.arrayContaining([
        ['first', { pathway: 'R-HSA-69620' }],
        ['second', { pathway: 'R-HSA-5693567' }],
      ])
    );
  });

  // A single-page host app moves elements around. Moved within a tick, the
  // element keeps its diagram; removed for longer, it is torn down, and adding
  // it back draws it afresh.
  test('can be moved, or removed and added back', async ({ page }) => {
    await page.goto(`${HOST}/`);
    const nodes = await drawn(page);
    const cyNodes = () =>
      page.evaluate(() => (window as unknown as EmbedGlobals).__cy('diagram').cy.nodes().length);
    await page.evaluate(() => {
      const el = (window as unknown as EmbedGlobals).__el('diagram');
      const parent = el.parentElement;
      if (!parent) throw new Error('#diagram has no parent');
      el.remove();
      parent.appendChild(el);
    });
    await page.waitForTimeout(500);
    expect(await cyNodes(), 'moved: still drawn').toBe(nodes);

    await page.evaluate(() => {
      const w = window as unknown as EmbedGlobals;
      w.__held = w.__el('diagram');
      w.__held.remove();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const w = window as unknown as EmbedGlobals;
      w.__events.length = 0;
      if (w.__held) document.body.appendChild(w.__held);
    });
    expect(await drawn(page), 'removed and added back: drawn again').toBe(nodes);
  });

  test('is harmless when its script is included twice', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${HOST}/twice.html`);
    await drawn(page);
    expect(await events(page, 'diagramloaded')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('says so when a pathway cannot be shown, and the page carries on', async ({ page }) => {
    await page.goto(`${HOST}/configurable.html?pathway=R-HSA-999999999`);
    await expect
      .poll(async () => (await events(page, 'diagramerror')).map(([, , d]) => d), { timeout: LOAD })
      .toEqual([{ pathway: 'R-HSA-999999999', reason: 'not-found' }]);
    await expect(page.locator('#diagram reactome-diagram-view').locator('.message')).toHaveText(
      'This pathway could not be shown.'
    );
    expect(await page.evaluate(() => 1 + 1), 'the host page still runs').toBe(2);
  });

  // The page partners are sent to, served beside the code. Its picker is also
  // the one place a live element's pathway is changed after it has drawn.
  test('the demo page draws, and redraws when another pathway is picked', async ({ page }) => {
    await page.goto(`${EMBED}demo.html`);
    await drawn(page);
    await expect(page.locator('#status')).toHaveText('Showing R-HSA-69620.');
    await expect(page.locator('#snippet')).toContainText(`${EMBED}reactome-diagram.js`);

    await page.locator('#pathway').selectOption('R-HSA-1257604');
    await expect
      .poll(async () => (await events(page, 'diagramloaded')).map(([, , d]) => d), {
        timeout: LOAD,
      })
      .toEqual([{ pathway: 'R-HSA-69620' }, { pathway: 'R-HSA-1257604' }]);
    await expect(page.locator('#status')).toHaveText('Showing R-HSA-1257604.');
    const shown = await page.evaluate(
      () => (window as unknown as EmbedGlobals).__cy('diagram').cy.nodes().length
    );
    expect(shown, 'the new pathway is drawn').toBeGreaterThan(0);
  });
});
