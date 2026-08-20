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
