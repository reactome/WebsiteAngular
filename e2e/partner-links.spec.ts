import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * The addresses other sites already use for Reactome, kept working (spec 009,
 * Story 4). AllianceGenome's gene pages show reaction figures from the
 * exporter by <img src>; PubChem hosts snapshots of the diagram exporter's
 * images and links to the Pathway Browser as `/PathwayBrowser/#/{stId}`. None
 * of them will change their links for us, so these are held here.
 *
 * Each image is checked by what it is -- its first bytes -- not by its status:
 * an image address that answers 200 with HTML is the failure this is for.
 */

// A reaction and a pathway, as the local backend has them (T037): R-HSA-69891,
// "Phosphorylation and activation of CHEK2 by ATM"; R-HSA-2206280, "MPS IX -
// Natowicz syndrome", chosen for a diagram small enough to record.
const REACTION = 'R-HSA-69891';
const PATHWAY = 'R-HSA-2206280';

const IS: Record<string, (bytes: Buffer) => boolean> = {
  svg: (bytes) => bytes.subarray(0, 400).toString('utf8').includes('<svg'),
  png: (bytes) =>
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};

/**
 * What an image address answers. Opened by the page, as an <img> would ask for
 * it, so the answer comes from the recordings in CI and is recorded here.
 */
async function image(page: Page, url: string) {
  const response = await page.goto(url);
  if (!response) throw new Error(`no answer for ${url}`);
  return {
    status: response.status(),
    type: response.headers()['content-type'] ?? '',
    bytes: await response.body(),
  };
}

test.describe('addresses partners use', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  for (const [kind, id, format] of [
    ['reaction', REACTION, 'svg'],
    ['reaction', REACTION, 'png'],
    ['diagram', PATHWAY, 'svg'],
    ['diagram', PATHWAY, 'png'],
    ['diagram', PATHWAY, 'jpg'],
  ] as const) {
    test(`the ${kind} exporter's .${format} is a ${format.toUpperCase()}`, async ({ page }) => {
      const answer = await image(page, `/ContentService/exporter/${kind}/${id}.${format}`);
      expect(answer.status, `${kind}/${id}.${format}`).toBe(200);
      expect(answer.type, 'content type').toMatch(/^image\//);
      expect(IS[format](answer.bytes), `the bytes of ${kind}/${id}.${format} are a ${format}`).toBe(
        true
      );
    });
  }

  test('an old Pathway Browser link, as PubChem writes it, opens that pathway', async ({
    page,
  }) => {
    await page.goto(`/PathwayBrowser/#/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 90_000 })
      .toBe(`/PathwayBrowser/${PATHWAY}`);
    await page.waitForFunction(
      () => {
        const container = document.querySelector('#cytoscape') as
          (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
        return (container?._cyreg?.cy?.elements().length ?? 0) > 0;
      },
      null,
      { timeout: 90_000 }
    );
  });
});
