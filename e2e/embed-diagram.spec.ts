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
        ?.shadowRoot?.querySelector('reactome-diagram-view')
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

/**
 * How many pixels of two same-sized screenshots differ, in any channel, by more
 * than `threshold` levels. Decoded by the browser, so nothing but public APIs.
 */
async function significantPixels(page: Page, a: Buffer, b: Buffer, threshold: number) {
  return page.evaluate(
    async ([a, b, threshold]) => {
      const pixels = async (base64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('no 2d context');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([pixels(a), pixels(b)]);
      if (x.width !== y.width || x.height !== y.height) return x.width * x.height;
      let count = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const delta = Math.max(
          Math.abs(x.data[i] - y.data[i]),
          Math.abs(x.data[i + 1] - y.data[i + 1]),
          Math.abs(x.data[i + 2] - y.data[i + 2])
        );
        if (delta > threshold) count++;
      }
      return count;
    },
    [a.toString('base64'), b.toString('base64'), threshold] as const
  );
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
      ?.shadowRoot?.querySelector('reactome-diagram-view')
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
 * Whatever of the host page the diagram must leave exactly as it found it,
 * recorded before any script on it ran -- a snapshot taken after load would
 * already include whatever the diagram did while loading. `hostState` reads it
 * again with the same code.
 */
async function recordHostBaseline(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as HostGlobals;
    // Two libraries write to the head whatever a page does, and neither can
    // touch the partner's page: cytoscape a rule for its own container class,
    // and the CDK's breakpoint observer empty `@media … { body {} }` rules, a
    // WebKit workaround. Anything else in the head after load is ours.
    const inert = (e: Element) =>
      e.id === '__________cytoscape_stylesheet' ||
      (e instanceof HTMLStyleElement &&
        !e.textContent &&
        [...(e.sheet?.cssRules ?? [])].every(
          (rule) =>
            rule instanceof CSSMediaRule &&
            [...rule.cssRules].every((r) => r instanceof CSSStyleRule && r.style.length === 0)
        ));
    w.__hostState = () => ({
      href: location.href,
      history: history.length,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      storage: Object.keys(localStorage).sort().join(','),
      bodyClass: document.body.className,
      bodyStyle: document.body.style.cssText,
      // Libraries append to <body> too: an element of ours there is on the
      // partner's page, in their layout.
      body: [...document.body.children].map((e) => e.tagName).join(','),
      height: document.documentElement.scrollHeight,
      head: [...document.head.children]
        .filter((e) => !inert(e))
        .map((e) => e.tagName)
        .join(','),
    });
    document.addEventListener('DOMContentLoaded', () => (w.__baseline = w.__hostState()), {
      once: true,
      capture: true,
    });
    // Except the page's height, which changes as it should once the element is
    // defined: until then it is an unknown, inline element, and ignores the
    // size the partner gave it. Taken once it has its box, before the diagram
    // has drawn anything.
    void customElements
      .whenDefined('reactome-diagram')
      .then(() =>
        requestAnimationFrame(() => (w.__sizedHeight = document.documentElement.scrollHeight))
      );
  });
}

type HostGlobals = {
  __hostState(): Record<string, unknown>;
  __baseline: Record<string, unknown>;
  __sizedHeight: number;
};

async function hostState(page: Page) {
  return page.evaluate(() => (window as unknown as HostGlobals).__hostState());
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
    const before = await page.evaluate(() => {
      const w = window as unknown as HostGlobals;
      return { ...w.__baseline, height: w.__sizedHeight };
    });
    expect(await hostState(page), 'nothing changed while the diagram loaded').toEqual(before);
    // The controls' tooltip text, as their accessible description on the
    // control itself rather than in a container on the partner's body.
    await expect(page.locator('#diagram reactome-diagram-view #fit')).toHaveAttribute(
      'aria-description',
      'Fit to screen'
    );

    const box = await boxOf(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    const [node] = await twoNodes(page);
    await page.mouse.click(node.x, node.y);
    await expect.poll(() => selectedIds(page)).toEqual([node.id]);
    // The wheel over the diagram zooms it; it must not scroll the page.
    expect(await hostState(page)).toEqual(before);

    // Double-clicking a pathway box is the browser's navigation: here it goes
    // to that pathway inside the element, and not in the partner's address.
    const box2 = await page.evaluate(() => {
      const { cy, box } = (window as unknown as EmbedGlobals).__cy('diagram');
      const [target] = cy
        .nodes('.Interacting.Pathway')
        .filter((n: CyNode) => Boolean(n.data('graph.stId')));
      if (!target) throw new Error('no pathway box in the diagram');
      const p = target.renderedPosition();
      return { id: String(target.data('graph.stId')), x: box.left + p.x, y: box.top + p.y };
    });
    await page.mouse.dblclick(box2.x, box2.y);
    await expect
      .poll(async () => (await events(page, 'diagramloaded')).map(([, , d]) => d), {
        timeout: LOAD,
      })
      .toContainEqual({ pathway: box2.id });
    expect(await hostState(page), 'navigating inside the diagram').toEqual(before);
  });

  test("keeps its styles and the host's apart", async ({ page }, testInfo) => {
    // Cytoscape does not rasterise a diagram identically twice under load:
    // the same page drawn twice on a throttled CPU differs in ~160 pixels, by
    // at most ~35 levels -- antialiasing, not content. Comparing for exact
    // identity failed on CI runners for that alone. A style that reaches in
    // changes glyphs and colours against their background, by far more: with
    // the frame's reset removed, 339,352 pixels differ, up to 255 levels. So
    // what counts is a pixel that differs by more than that noise ever does --
    // and, for a leak too faint for that (a slight tint or fade over the whole
    // diagram), more pixels differing a little than noise ever makes.
    const SIGNIFICANT = 64;
    const FAINT = 16;
    const FAINT_ALLOWED = 1000;
    const shot = async (url: string) => {
      await page.goto(url);
      await drawn(page);
      await page.evaluate(() => document.fonts.ready);
      // Until it has stopped drawing: two shots in a row with nothing
      // significant between them.
      let previous = await page.locator('#diagram').screenshot();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        const next = await page.locator('#diagram').screenshot();
        if ((await significantPixels(page, previous, next, SIGNIFICANT)) === 0) return next;
        previous = next;
      }
      throw new Error(`the diagram on ${url} never stopped changing`);
    };
    // The web fonts first. The diagram fits itself to its labels as soon as it
    // is drawn, and a label measured before Roboto has arrived is a different
    // width: on a cold cache the first page was framed differently from the
    // second, which found the fonts cached -- 40,000 pixels apart on a CI
    // runner, and the same locally with the fonts held back. Loaded once and
    // thrown away, both pages below draw with the fonts already there.
    await page.goto(`${HOST}/plain.html`);
    await drawn(page);
    await page.evaluate(() => document.fonts.ready);
    // plain.html is hostile.html without its stylesheet: the same layout, so
    // any difference is the styles reaching in.
    const plain = await shot(`${HOST}/plain.html`);
    const hostile = await shot(`${HOST}/hostile.html`);
    const differing = await significantPixels(page, plain, hostile, SIGNIFICANT);
    const faint = await significantPixels(page, plain, hostile, FAINT);
    if (differing > 0 || faint >= FAINT_ALLOWED) {
      await testInfo.attach('plain', { body: plain, contentType: 'image/png' });
      await testInfo.attach('hostile', { body: hostile, contentType: 'image/png' });
    }
    expect(differing, 'pixels of the diagram changed by hostile page styles').toBe(0);
    expect(faint, 'pixels of the diagram faintly changed').toBeLessThan(FAINT_ALLOWED);

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
    // The diagram is in the element's shadow root: none of the partner's DOM
    // calls see it, and a copy of the element does not copy it.
    expect(
      await page.evaluate(() => (window as unknown as EmbedGlobals).__el('diagram').children.length)
    ).toBe(0);
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

  test('removed while it loads, leaves nothing behind on the window', async ({ page }) => {
    // cytoscape binds its listeners on window, and only destroying the
    // instance removes them. One made after its element was gone -- its data
    // arriving late -- used to have nothing left to destroy it.
    const cdp = await page.context().newCDPSession(page);
    const windowListeners = async () => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
        objectId: result.objectId ?? '',
      });
      return listeners.length;
    };
    await page.goto(`${HOST}/`);
    await drawn(page);
    await page.waitForTimeout(1000);
    const withOne = await windowListeners();

    await page.route('**/diagram/R-HSA-5693567*.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fallback();
    });
    await page.evaluate(() => {
      const el = document.createElement('reactome-diagram');
      el.id = 'brief';
      el.setAttribute('pathway', 'R-HSA-5693567');
      document.body.appendChild(el);
      // Gone well before its diagram arrives, and long enough to be torn down.
      setTimeout(() => el.remove(), 1000);
    });
    await page.waitForTimeout(6000);
    expect(await windowListeners(), "the removed diagram's listeners").toBe(withOne);
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

  test('can be loaded both ways on one page', async ({ page }) => {
    // The loader, and main.js in the partner's own bundle: one definition wins
    // and the other stands down.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${HOST}/mixed.html`);
    await drawn(page);
    expect(await events(page, 'diagramloaded')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('takes a pathway set as a property before its code loaded', async ({ page }) => {
    await page.goto(`${HOST}/early-property.html`);
    expect(await drawn(page)).toBeGreaterThan(0);
  });

  test('draws the parent of a pathway without its own diagram, and reports no error', async ({
    page,
  }) => {
    // R-HSA-69541, Stabilization of p53, is drawn in its parent's diagram.
    await page.goto(`${HOST}/configurable.html?pathway=R-HSA-69541`);
    await drawn(page);
    await page.waitForTimeout(1500);
    expect(await events(page, 'diagramerror')).toEqual([]);
  });

  test('reports a pathway it cannot show once, when switched to it', async ({ page }) => {
    // Two things find out, each on its own: the pathway lookup, and the
    // diagram's download. The download is held back so the lookup answers
    // first, which is the order that used to report the failure twice.
    await page.route('**/diagram/R-HSA-999999999*.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fallback();
    });
    await page.goto(`${HOST}/`);
    await drawn(page);
    await page.evaluate(() =>
      (window as unknown as EmbedGlobals).__el('diagram').setAttribute('pathway', 'R-HSA-999999999')
    );
    await expect
      .poll(async () => (await events(page, 'diagramerror')).length, { timeout: LOAD })
      .toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    expect((await events(page, 'diagramerror')).map(([, , d]) => d)).toEqual([
      { pathway: 'R-HSA-999999999', reason: 'not-found' },
    ]);
    await expect(page.locator('#diagram reactome-diagram-view').locator('.message')).toHaveText(
      'This pathway could not be shown.'
    );
  });

  test('says so on the page when switched to a pathway it cannot show', async ({ page }) => {
    // Its failure can land outside change detection, and the view then has to
    // refresh on its own -- which it did not while the failed lookup threw on
    // every read. Nothing is held back here: the order the failures arrive in
    // unaided is the one that showed it.
    await page.goto(`${HOST}/`);
    await drawn(page);
    await page.evaluate(() =>
      (window as unknown as EmbedGlobals).__el('diagram').setAttribute('pathway', 'R-HSA-999999999')
    );
    await expect(page.locator('#diagram reactome-diagram-view').locator('.message')).toHaveText(
      'This pathway could not be shown.',
      { timeout: LOAD }
    );
    await page.waitForTimeout(3000);
    expect(await events(page, 'diagramerror')).toHaveLength(1);
  });

  test('opens the right-click popup at the pointer, with its icons', async ({ page }) => {
    await page.goto(`${HOST}/`);
    await drawn(page);
    const [node] = await twoNodes(page);
    await page.mouse.click(node.x, node.y, { button: 'right' });
    const popup = page.locator('#diagram .entity-popup');
    await expect(popup).toBeVisible({ timeout: LOAD });
    const box = await popup.boundingBox();
    if (!box) throw new Error('the popup has no box');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    // Where the popup puts itself: at the pointer, kept 8px inside the window.
    const at = (pointer: number, size: number, room: number) =>
      Math.max(8, Math.min(pointer, room - size - 8));
    expect(Math.abs(box.x - at(node.x, box.width, viewport.width))).toBeLessThan(2);
    expect(Math.abs(box.y - at(node.y, box.height, viewport.height))).toBeLessThan(2);
    // An icon is set in its icon font, not in the text face as its own name.
    const font = await popup
      .locator('mat-icon')
      .first()
      .evaluate((icon) => getComputedStyle(icon).fontFamily);
    expect(font).toContain('Material Icons');
  });
});
