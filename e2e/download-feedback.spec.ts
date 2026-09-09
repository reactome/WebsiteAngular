import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { serves } from './fixtures/serves';

/**
 * What a download tells you while it is being made, and what it does when it
 * cannot be.
 *
 * A diagram's PowerPoint and GIF are rendered on demand and take seconds.
 * Handed to the browser as `<a href download>` that wait is silent, and — the
 * part that matters — a failure is *saved*: the render service answers an id it
 * cannot resolve with `404 {"error":"no such pathway"}`, and the browser writes
 * those 41 bytes into a `.pptx` that PowerPoint then offers to repair. The
 * reader is told nothing and left holding a broken file.
 *
 * The failure test routes the request itself, so it runs whether or not a
 * render service is up. The success test needs a real render and skips without
 * one.
 */

const DIAGRAM = 'R-HSA-109606';
const BOOT_TIMEOUT = 90_000;

async function openDownloadTab(page: Page) {
  await page.goto(`/PathwayBrowser/${DIAGRAM}`);
  await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
  // The diagram keeps drawing after its first canvas.
  await page.waitForTimeout(2500);
  await page
    .locator('[role="tab"]')
    .filter({ hasText: /Download/i })
    .first()
    .click();
  await expect(page.locator('cr-download-tab')).toBeVisible();
}

const pptxButton = (page: Page) =>
  page.locator('.container.diagram').getByText('PPTX', { exact: true }).first();

test.describe('Download feedback', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  test('says the file is being made, then saves it', async ({ page, request }) => {
    const up = await serves(request, '/RenderService/health');
    test.skip(!up, 'the render service is not running; a PPTX comes from it');

    await openDownloadTab(page);

    const seen: string[] = [];
    const watch = setInterval(() => {
      void page
        .locator('.button__state')
        .first()
        .textContent({ timeout: 150 })
        .then((text) => {
          const state = text?.trim();
          if (state && !seen.includes(state)) seen.push(state);
        })
        .catch(() => undefined);
    }, 200);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 240_000 }),
      pptxButton(page).click(),
    ]);
    clearInterval(watch);

    // Named from Content-Disposition rather than from the URL.
    expect(download.suggestedFilename()).toBe(`${DIAGRAM}.pptx`);

    const bytes = readFileSync(await download.path());
    expect(bytes.length).toBeGreaterThan(4000);
    expect(bytes[0], 'a real zip, so a real pptx').toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    // The reader was told something while they waited. "Preparing" is the one
    // that has to be there: until the file exists the server sends nothing, so
    // a percentage alone would leave the wait silent.
    expect(seen.join(' '), `states seen: ${seen.join(', ')}`).toMatch(/Preparing|%|Downloading/);

    // And the button is not left spinning.
    await expect(page.locator('.button--busy')).toHaveCount(0);
  });

  test('shows the reason it failed, and saves nothing', async ({ page }) => {
    await page.route('**/RenderService/render/**', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"error":"no such pathway: R-HSA-000000"}',
      })
    );

    await openDownloadTab(page);

    let saved: string | null = null;
    page.on('download', (download) => {
      saved = download.suggestedFilename();
    });

    await pptxButton(page).click();
    await expect(page.locator('.button--failed')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('.button__state').first()).toHaveText('Failed');

    // The whole point: nothing was written to disk.
    expect(saved, 'a failed download must not save a file').toBeNull();

    // And the reason is the server's own, with what to do about it.
    await page.locator('.button--failed').first().hover();
    await expect(
      page
        .locator('[role="tooltip"]')
        .filter({ hasText: /Could not download/ })
        .first()
    ).toContainText('no such pathway: R-HSA-000000');
  });

  test('leaves a modified click to the browser', async ({ page }) => {
    // Ctrl-click, middle-click and "save link as" are the reader asking the
    // browser to handle the link. The button must still be a link.
    await openDownloadTab(page);
    const href = await pptxButton(page)
      .locator('xpath=ancestor-or-self::a')
      .first()
      .getAttribute('href');
    expect(href, 'still a real anchor with a real href').toContain('/RenderService/render/');
  });
});
