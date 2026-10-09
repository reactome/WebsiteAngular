import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// The Voronoi map of all pathways (FoamTree). It is drawn on a canvas, so what
// the reader sees is checked in pixels.

const BOOT = 90_000;

type FoamTree = {
  get(option: 'dataObject'): { groups: { label: string }[] };
  get(
    option: 'geometry',
    group: object
  ): { polygonCenterX: number; polygonCenterY: number } | undefined;
};
type Probe = { ng: { getComponent(el: Element | null): { foamTree(): FoamTree } } };

/** The map, laid out and done animating. */
async function openMap(page: Page) {
  await page.goto('/PathwayBrowser?tab=info', { waitUntil: 'domcontentloaded' });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const host = document.querySelector('cr-reacfoam');
          const probe = (window as unknown as Partial<Probe>).ng;
          if (!host || !probe) return 0;
          return probe.getComponent(host)?.foamTree()?.get('dataObject')?.groups?.length ?? 0;
        }),
      { timeout: BOOT }
    )
    .toBeGreaterThan(0);
  // Roll-out and relaxation run for up to four seconds.
  await page.waitForTimeout(6000);
}

/** Where a top-level pathway's cell is on the page. */
async function centreOf(page: Page, label: string) {
  return page.evaluate((label) => {
    const host = document.querySelector('cr-reacfoam');
    const canvas = host?.querySelector('canvas')?.getBoundingClientRect();
    if (!host || !canvas) return undefined;
    const foamTree = (window as unknown as Probe).ng.getComponent(host).foamTree();
    const group = foamTree.get('dataObject').groups.find((g) => g.label === label);
    const at = group && foamTree.get('geometry', group);
    return at
      ? { x: canvas.left + at.polygonCenterX, y: canvas.top + at.polygonCenterY }
      : undefined;
  }, label);
}

/**
 * How much of the bottom strip of the map is dark: the title bar FoamTree
 * draws there is a dark band with the name in it. Read from FoamTree's own
 * canvases, composited, because byte-comparing screenshots is not enough --
 * hovering any cell changes a few pixels of the strip as well.
 */
function darkInTitleStrip(page: Page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('cr-reacfoam canvas')];
    const { width, height } = canvases[0];
    const top = Math.floor(height * 0.85);
    const all = document.createElement('canvas');
    all.width = width;
    all.height = height;
    const context = all.getContext('2d');
    if (!context) throw new Error('no 2d context');
    for (const c of canvases) context.drawImage(c, 0, 0, width, height);
    const pixels = context.getImageData(0, top, width, height - top).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] > 0 && pixels[i] + pixels[i + 1] + pixels[i + 2] < 3 * 90) dark++;
    return dark / (pixels.length / 4);
  });
}

/** The dark share of the title strip before and after hovering a pathway. */
async function hovering(page: Page, label: string) {
  const box = await page.locator('cr-reacfoam').boundingBox();
  const centre = await centreOf(page, label);
  if (!box || !centre) throw new Error(`${label} is not on the map`);
  // Off the map: anywhere on it is over some pathway, and a small one would
  // show its own title bar.
  await page.mouse.move(Math.max(0, box.x - 20), box.y + box.height / 2);
  await page.waitForTimeout(500);
  const before = await darkInTitleStrip(page);
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(1000);
  return { before, after: await darkInTitleStrip(page) };
}

test.describe('The Voronoi map of pathways', () => {
  test.setTimeout(4 * 60 * 1000);

  // That the measure can see a title bar at all: a small pathway always had one.
  test('names a small pathway under the pointer', async ({ page }) => {
    await openMap(page);
    const { before, after } = await hovering(page, 'Muscle contraction');
    expect(after - before, `dark share of the strip: ${before} -> ${after}`).toBeGreaterThan(0.1);
  });

  test('names the pathway under the pointer, however large its own label', async ({ page }) => {
    await openMap(page);
    // Signal Transduction: a large cell with a label anyone can read, at the
    // top, away from the strip where the title bar is drawn. FoamTree named a
    // pathway on hover only when its label was small, so hovering here showed
    // nothing while smaller pathways got a name.
    const { before, after } = await hovering(page, 'Signal Transduction');
    // A title bar darkens a good part of the strip; a hover highlight does not.
    expect(after - before, `dark share of the strip: ${before} -> ${after}`).toBeGreaterThan(0.1);
  });
});
