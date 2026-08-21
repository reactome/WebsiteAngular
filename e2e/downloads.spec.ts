import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';

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
    floor: 10_000,
  },
};

async function openDownloadTab(page: Page, pathway: string) {
  await page.goto(`/PathwayBrowser/${pathway}`);
  await page.waitForSelector('#cytoscape canvas, cr-ehld svg', { timeout: 90_000 });
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
      const health = await request.get('/RenderService/health').catch(() => null);
      test.skip(
        !health?.ok(),
        'the render service is not running; GIF and PPTX come from it, so this says nothing about the build'
      );

      await openDownloadTab(page, DIAGRAM);
      assertLooksLike(format, await grab(page, format));
    });
  }
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
      const health = await request.get('/RenderService/health').catch(() => null);
      test.skip(
        !health?.ok(),
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
    });
  }

  // The three PNG entries have to be three different pictures. A menu that
  // offers Low, Medium and High and returns the same bytes for each is worse
  // than one that offers a single PNG.
  test('the PNG tiers are three different sizes', async ({ page, request }) => {
    const health = await request.get('/RenderService/health').catch(() => null);
    test.skip(!health?.ok(), 'the render service is not running; the tiers come from it');

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
