import { serves } from './fixtures/serves';
import { type Page, type Download } from '@playwright/test';
import { test, expect } from './support/backend';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

// Downloads, checked by what is *in* the file rather than that a file arrived.
//
// Every bug in this area this month passed a "did something download" check and
// would have failed this one: a .jpeg containing PNG bytes (cytoscape-layers
// overrides cy.jpg and ends with output(..., 'image/png')), a .pdf of an
// illustration that was a blank 674 bytes, and an illustration PNG that held the
// top-left ninth of the picture scaled up.
//
// GIF and PPTX come from the render service, which is a separate process. Where
// it is not running -- CI, a fresh checkout -- those are skipped with a reason
// rather than failed: they say nothing about the build.

const DIAGRAM = 'R-HSA-109606'; // Intrinsic Pathway for Apoptosis: a cytoscape diagram
const ILLUSTRATION = 'R-HSA-109581'; // Apoptosis: an EHLD

/**
 * A heavy illustration, which is the one that catches the bug this file missed.
 *
 * Apoptosis' illustration is 502 SVG elements and arrives quickly. Signal
 * Transduction's is 2,490 and is one of the 96 illustrations out of 218 that the
 * render service drew as a 140x140 picture of the zoom control instead of the
 * pathway: the readiness probe accepted any `svg` inside `cr-ehld`, the control
 * is in the DOM from the first frame, and a heavy illustration is still loading
 * when the light one has arrived. Every existing test here used the light one
 * and stayed green throughout.
 */
const HEAVY_ILLUSTRATION = 'R-HSA-162582'; // Signal Transduction: a large EHLD

/** A PNG's own idea of its size, from the IHDR chunk. */
function pngSize(bytes: Buffer) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** What each format's bytes have to start with, and a floor for "not empty". */
const SIGNATURES: Record<string, { magic: (bytes: Buffer) => boolean; floor: number }> = {
  SVG: {
    magic: (bytes) => bytes.subarray(0, 400).toString('utf8').includes('<svg'),
    floor: 2000,
  },
  PNG: {
    magic: (bytes) =>
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    floor: 5000,
  },
  JPEG: {
    magic: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    floor: 5000,
  },
  GIF: { magic: (bytes) => bytes.subarray(0, 6).toString('latin1') === 'GIF89a', floor: 5000 },
  PPTX: {
    // A zip whose payload is a presentation, not merely a zip.
    magic: (bytes) =>
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes.toString('latin1').includes('ppt/presentation.xml'),
    // A slide of shapes is small: the package boilerplate is around 4.9KB and
    // each shape adds tens of bytes, so a reaction's figure is 5.6KB. The 10KB
    // this used to be was right when the package carried a picture of the
    // diagram, and rejected a perfectly good reaction. `shapesIn` below is what
    // now says whether there is a diagram in there.
    floor: 4000,
  },
};

/**
 * How many shapes a slide holds, and how large the slide is.
 *
 * A PowerPoint download is worth having because a person can take the diagram
 * apart on the slide, and a byte count cannot tell you whether they can. This
 * reads the slide itself.
 */
function slideOf(bytes: Buffer) {
  const parts = unzipSync(new Uint8Array(bytes));
  const slide = strFromU8(parts['ppt/slides/slide1.xml']);
  const size = /<p:sldSz cx="(\d+)" cy="(\d+)"\/>/.exec(strFromU8(parts['ppt/presentation.xml']));
  return {
    shapes: (slide.match(/<p:sp>/g) ?? []).length,
    pictures: (slide.match(/<p:pic>/g) ?? []).length,
    width: Number(size?.[1] ?? 0),
  };
}

async function openDownloadTab(page: Page, pathway: string) {
  await page.goto(`/PathwayBrowser/${pathway}`);
  // `#ehld` specifically: `cr-ehld svg` also matches the component's 70x70 zoom
  // control, which is there from the first frame, so waiting on it returns
  // before the illustration exists.
  await page.waitForSelector('#cytoscape canvas, cr-ehld #ehld svg', { timeout: 90_000 });
  await page
    .locator('[role="tab"]')
    .filter({ hasText: /Download/i })
    .first()
    .click();
  await expect(page.locator('cr-download-tab')).toBeVisible();
  // The diagram keeps drawing after its first canvas; exporting mid-draw is a
  // different picture.
  await page.waitForTimeout(2500);
}

async function grab(page: Page, format: string): Promise<Buffer> {
  // By the label's own text, exactly. The button renders its material icon as a
  // ligature inside the same anchor, so the button's text content is "imageSVG"
  // and an anchored match against the whole button matches nothing at all.
  const button = page.locator('.container.diagram').getByText(format, { exact: true });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    button.first().click(),
  ]);
  return readFileSync(await (download as Download).path());
}

function assertLooksLike(format: string, bytes: Buffer) {
  const signature = SIGNATURES[format];
  expect(bytes.length, `${format} size`).toBeGreaterThan(signature.floor);
  expect(
    signature.magic(bytes),
    `${format} content is really ${format}, not something renamed`
  ).toBe(true);
}

test.describe('Diagram downloads', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  for (const format of ['SVG', 'PNG', 'JPEG']) {
    test(`a diagram's ${format} contains ${format}`, async ({ page }) => {
      await openDownloadTab(page, DIAGRAM);
      assertLooksLike(format, await grab(page, format));
    });
  }

  for (const format of ['SVG', 'PNG', 'JPEG']) {
    test(`an illustration's ${format} contains ${format}`, async ({ page }) => {
      await openDownloadTab(page, ILLUSTRATION);
      assertLooksLike(format, await grab(page, format));
    });
  }

  test('a heavy illustration downloads the illustration, not the zoom control', async ({
    page,
  }) => {
    await openDownloadTab(page, HEAVY_ILLUSTRATION);
    const bytes = await grab(page, 'PNG');
    assertLooksLike('PNG', bytes);

    // The failure had a shape: the control is 70x70 CSS pixels, so it came out
    // at 140x140 and 8,091 bytes -- comfortably over the 5,000-byte floor this
    // file already applied, which is why a size check alone never caught it.
    // An illustration is 1600x1000 before scaling.
    const { width, height } = pngSize(bytes);
    expect(
      Math.min(width, height),
      `the PNG is ${width}x${height}, which is the zoom control rather than the illustration`
    ).toBeGreaterThan(500);
  });

  test('leaving out sub-pathway highlighting changes the figure', async ({ page }) => {
    await openDownloadTab(page, DIAGRAM);
    const withTints = await grab(page, 'SVG');

    await page.locator('cr-download-tab mat-checkbox input').first().click({ force: true });
    await page.waitForTimeout(500);
    const without = await grab(page, 'SVG');

    // The tints and their labels are a large part of the markup; without them the
    // file is meaningfully smaller. Equal sizes mean the checkbox did nothing.
    expect(without.length, 'SVG without sub-pathway tints').toBeLessThan(withTints.length);
  });
});

test.describe('Server-rendered figures', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  for (const format of ['GIF', 'PPTX']) {
    test(`a diagram's ${format} contains ${format}`, async ({ page, request }) => {
      const renderServiceUp = await serves(request, '/RenderService/health');
      test.skip(
        !renderServiceUp,
        'the render service is not running; GIF and PPTX come from it, so this says nothing about the build'
      );

      await openDownloadTab(page, DIAGRAM);
      const bytes = await grab(page, format);
      assertLooksLike(format, bytes);

      if (format === 'PPTX') {
        // The point of the format. Curators reported the diagram arriving as
        // "a single item", which is what one picture on a slide is, so a slide
        // with a picture on it is the failure this guards.
        const slide = slideOf(bytes);
        expect(slide.shapes, 'a shape per glyph, not a picture of all of them').toBeGreaterThan(
          100
        );
        expect(slide.pictures, 'no picture of the diagram').toBe(0);
      }
    });
  }

  test('a heavy illustration renders as the illustration', async ({ request }) => {
    const renderServiceUp = await serves(request, '/RenderService/health');
    test.skip(!renderServiceUp, 'the render service is not running');

    // Not only the download tab: a content detail page takes its picture from
    // this service too, so 96 of 218 illustrated pathways showed a 140x140
    // zoom control where the pathway should be. Asked here rather than through
    // the page because the service caches by URL, and a wrong render was kept
    // and served for as long as the cache lived.
    const response = await request.get(`/RenderService/render/${HEAVY_ILLUSTRATION}.png`);
    expect(response.ok(), 'the render service answers for a heavy illustration').toBe(true);

    const bytes = Buffer.from(await response.body());
    const { width, height } = pngSize(bytes);
    expect(
      Math.min(width, height),
      `rendered ${width}x${height}, which is the zoom control rather than the illustration`
    ).toBeGreaterThan(500);
  });
});

// The reaction page's own downloads.
//
// They used to sit above the summation, nowhere near the figure they produce,
// and a reaction had no figure formats at all -- the bar only offered them for
// pathways. They now live in the reaction diagram section, the way the current
// site lists them, and the figure formats come from the render service asked for
// the reaction's own layout rather than from the old server-side exporters.
const REACTION = 'R-HSA-6805479'; // TP53RK phosphorylates TP53

/** Same reason as in detail-contents: production 404s this endpoint. */
async function servesReactionDiagram(request: import('@playwright/test').APIRequestContext) {
  const response = await request
    .get(`/ContentService/exporter/reaction/${REACTION}/diagram`)
    .catch(() => null);
  return !!response?.ok();
}

async function openReaction(page: Page) {
  await page.goto(`/content/detail/${REACTION}`);
  await page.waitForSelector('cr-reaction-diagram canvas', { timeout: 90_000 });
  await page.waitForTimeout(2000);
}

async function grabFrom(page: Page, format: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.locator('.figure-tools').first().getByText(format, { exact: true }).click(),
  ]);
  return readFileSync(await (download as Download).path());
}

test.describe('Reaction page downloads', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  test('the download links sit in the reaction diagram section, above the figure', async ({
    page,
    request,
  }) => {
    test.skip(
      !(await servesReactionDiagram(request)),
      'this backend does not serve a reaction its own diagram'
    );
    await openReaction(page);

    const tools = page.locator('.reaction-figure .figure-tools');
    await expect(tools, 'the toolbar belongs to the reaction diagram section').toBeVisible();

    // Exactly one: the page projects a copy for reactions and a copy for
    // everything else, and only one of them may ever render.
    await expect(page.locator('.figure-tools')).toHaveCount(1);

    // Defaults that fail the comparison rather than assertions that throw: a
    // missing box means the thing is not laid out, which is a real failure and
    // should read as one.
    const bar = (await tools.boundingBox()) ?? { y: Infinity };
    const figure = (await page.locator('cr-reaction-diagram').boundingBox()) ?? { y: -Infinity };
    expect(bar.y, 'the links are above the figure').toBeLessThan(figure.y);

    // The set the current site offers for a reaction, nothing dropped -- except
    // BioPAX Level 2, which is superseded: one BioPAX link, Level 3.
    for (const label of ['SBML', 'BioPAX', 'PDF', 'SVG', 'PPTX', 'SBGN']) {
      await expect(tools.getByText(label, { exact: true })).toBeVisible();
    }
    // PNG still opens a menu, and its material icon renders as a ligature inside
    // the button, so the text reads "PNGarrow_drop_down" -- an exact match against
    // that finds nothing.
    await expect(tools.getByRole('button', { name: /^PNG/ })).toBeVisible();

    // And the one link really is Level 3.
    expect(
      await tools.getByText('BioPAX', { exact: true }).getAttribute('href'),
      'BioPAX means Level 3'
    ).toContain('Level3');
  });

  test('a figure format asks the render service for the reaction layout', async ({
    page,
    request,
  }) => {
    test.skip(
      !(await servesReactionDiagram(request)),
      'this backend does not serve a reaction its own diagram'
    );
    await openReaction(page);
    const tools = page.locator('.figure-tools').first();

    for (const format of ['svg', 'pptx']) {
      const href = await tools
        .getByText(format.toUpperCase(), { exact: true })
        .getAttribute('href');
      expect(href, `${format} comes from the render service`).toContain(
        `/RenderService/render/${REACTION}.${format}`
      );
      expect(href, `${format} asks for the reaction's own layout`).toContain('view=reaction');
    }
  });

  for (const format of ['SBML', 'SBGN', 'PDF']) {
    test(`a reaction's ${format} downloads`, async ({ page, request }) => {
      test.skip(
        !(await servesReactionDiagram(request)),
        'this backend does not serve a reaction its own diagram'
      );
      await openReaction(page);
      const bytes = await grabFrom(page, format);
      expect(bytes.length, `${format} size`).toBeGreaterThan(1000);
      // All three are documents rather than pictures: XML for the two exchange
      // formats, PDF for the report.
      const head = bytes.subarray(0, 8).toString('latin1');
      expect(
        format === 'PDF' ? head.startsWith('%PDF') : head.includes('<'),
        `${format} content`
      ).toBe(true);
    });
  }

  for (const format of ['SVG', 'PPTX']) {
    test(`a reaction's ${format} is the reaction's own figure`, async ({ page, request }) => {
      const renderServiceUp = await serves(request, '/RenderService/health');
      test.skip(
        !renderServiceUp,
        'the render service is not running; a reaction figure comes from it, so this says nothing about the build'
      );

      await openReaction(page);
      const bytes = await grabFrom(page, format);
      assertLooksLike(format, bytes);

      if (format === 'SVG') {
        // The reaction's layout is around a thousand points across; the pathway
        // diagram it lives in is four thousand. This is the difference between
        // the figure the page shows and the whole diagram behind it.
        const width = Number(/\bwidth="([\d.]+)"/.exec(bytes.toString('utf8'))?.[1] ?? 0);
        expect(width, 'the figure is the reaction, not its containing diagram').toBeLessThan(2500);
      }

      if (format === 'PPTX') {
        // The same claim, made the way a slide can be asked it: a handful of
        // shapes on a slide a few inches across, rather than the hundreds on
        // the 56in slide a whole pathway needs.
        const slide = slideOf(bytes);
        expect(slide.shapes, 'the reaction is drawn as shapes').toBeGreaterThan(2);
        expect(slide.pictures, 'no picture of the reaction').toBe(0);
        expect(
          slide.width / 914400,
          'the slide is the reaction, not its containing diagram'
        ).toBeLessThan(30);
      }
    });
  }

  // The three PNG entries have to be three different pictures. A menu that
  // offers Low, Medium and High and returns the same bytes for each is worse
  // than one that offers a single PNG.
  test('the PNG tiers are three different sizes', async ({ page, request }) => {
    const renderServiceUp = await serves(request, '/RenderService/health');
    test.skip(!renderServiceUp, 'the render service is not running; the tiers come from it');

    await openReaction(page);
    const tools = page.locator('.figure-tools').first();

    const widths: number[] = [];
    for (const tier of ['Low', 'Medium', 'High']) {
      await tools.getByRole('button', { name: /^PNG/ }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 240_000 }),
        page.getByRole('menuitem', { name: tier }).click(),
      ]);
      const bytes = readFileSync(await (download as Download).path());
      assertLooksLike('PNG', bytes);
      // The width is in the IHDR chunk, at a fixed offset in every PNG.
      widths.push(bytes.readUInt32BE(16));
    }

    expect(new Set(widths).size, `three distinct widths, got ${widths.join(', ')}`).toBe(3);
    expect(widths[0], 'Low is the smallest').toBeLessThan(widths[1]);
    expect(widths[1], 'High is the largest').toBeLessThan(widths[2]);
  });
});
