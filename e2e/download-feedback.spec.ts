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
        .locator('.button--busy .button__state')
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
    // Scoped to the button that failed: every button carries a live region,
    // empty until it has something to say, so `.first()` is somebody else's.
    await expect(page.locator('.button--failed .button__state')).toHaveText('Failed');

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

/**
 * The same treatment on the detail page's download bar, where the waits are
 * longest.
 *
 * These come from the content service's exporters, which stream while they
 * generate: a pathway's SBML is 807KB over eight seconds and a PDF 2MB over
 * eight, both with **no Content-Length at all**. So the browser cannot know how
 * big the file is, and a failure part-way through leaves a truncated file that
 * looks complete. Fetching it in the page cannot stop the streaming, but a
 * stream that breaks throws, and nothing broken is saved.
 */
test.describe('Download feedback on the detail bar', () => {
  test.describe.configure({ timeout: 5 * 60 * 1000 });

  const bar = (page: Page) => page.locator('.figure-tools');
  const sbml = (page: Page) =>
    page
      .locator('.dl-link')
      .filter({ hasText: /^SBML$/ })
      .first();

  async function openDetail(page: Page) {
    await page.goto(`/content/detail/${DIAGRAM}`);
    await expect(bar(page)).toBeVisible({ timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(1500);
  }

  test('shows the reason a slow export failed, and saves nothing', async ({ page }) => {
    // A 403 with an HTML body is what the exporter block answers, and an
    // `<a download>` saves that page as an .sbml file.
    await page.route('**/ContentService/exporter/**', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'text/html',
        body: '<!DOCTYPE HTML><html><head><title>403 Forbidden</title></head></html>',
      })
    );

    await openDetail(page);

    let saved: string | null = null;
    page.on('download', (download) => {
      saved = download.suggestedFilename();
    });

    await sbml(page).click();
    await expect(page.locator('.dl--failed')).toHaveCount(1, { timeout: 30_000 });

    expect(saved, 'a failed export must not be saved').toBeNull();

    // And the reader is not shown a page of HTML as the reason.
    const reason = await page.locator('.dl--failed').first().getAttribute('title');
    expect(reason).toContain('403');
    expect(reason).not.toContain('<');
  });

  test('can be stopped when the server never answers', async ({ page }) => {
    // A request that is never answered used to leave "Preparing…" on screen for
    // ever with nothing the reader could do: clicking again was ignored while
    // busy, and there is no browser download UI to cancel from because the page
    // is doing the fetching. There is a three minute ceiling as well, but
    // nobody should have to wait for it.
    await page.route('**/ContentService/exporter/**', () => {
      /* deliberately never fulfilled */
    });

    await openDetail(page);
    const sbml = page
      .locator('.dl-link')
      .filter({ hasText: /^SBML$/ })
      .first();

    await sbml.click();
    await expect(page.locator('.dl--busy')).toHaveCount(1, { timeout: 15_000 });
    await expect(sbml).toHaveAttribute('title', /click to stop/i);

    await sbml.click();
    await expect(page.locator('.dl--busy')).toHaveCount(0, { timeout: 15_000 });
  });

  test('says it is working during the wait', async ({ page, request }) => {
    // Gated on the content service, not on the exporter path: the exporters are
    // blocked for non-browser agents on beta, so probing one from the API
    // request context answers 403 and this test would skip for ever while the
    // browser it actually runs in gets a 200. The detail page below still needs
    // the content service even though the export no longer does.
    const reachable = await serves(request, `/ContentService/data/query/${DIAGRAM}`);
    test.skip(!reachable, 'the content service is not reachable from here');

    // The export is served here, and held, so that "working" is a state the test
    // cannot miss. It used to poll the DOM every 150ms against the real service
    // and assert it had caught a transient label -- which it does not when the
    // export comes back between two samples. That is how it failed on main on
    // 2026-09-09: `states seen:` with nothing after it, three attempts running.
    await page.route('**/ContentService/exporter/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({
        status: 200,
        contentType: 'application/xml',
        headers: { 'Content-Disposition': `attachment; filename="${DIAGRAM}.sbml"` },
        body: '<?xml version="1.0" encoding="UTF-8"?>\n<sbml level="3" version="1"></sbml>',
      });
    });

    await openDetail(page);

    const link = sbml(page);
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await link.click();

    // Asserted while the export is still being held, and on the label the reader
    // actually sees rather than on a class that merely implies it.
    await expect(link).toHaveAttribute('data-download-state', 'Preparing…', {
      timeout: 20_000,
    });

    const saved = await download;
    expect(saved.suggestedFilename()).toBe(`${DIAGRAM}.sbml`);
    const bytes = readFileSync(await saved.path());
    expect(bytes.subarray(0, 400).toString('utf8')).toContain('<sbml');

    // And it stops saying it is working once the file has arrived.
    await expect(page.locator('.dl--busy')).toHaveCount(0, { timeout: 20_000 });
  });
});
