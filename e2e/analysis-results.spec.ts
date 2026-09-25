import { type Page, type Download } from '@playwright/test';
import { test, expect } from './support/backend';
import { readFileSync } from 'node:fs';

// What an analysis is *for*: the numbers beside the pathways, the table you sort
// and filter, and the files you take away. The existing analysis spec drives the
// wizards up to the last step and stops, so everything after "Analyse" was
// unverified -- including the two overlays that have no wizard of their own.
//
// One analysis is created per test rather than shared: a token is server-side
// state, and a test that depends on another test's token fails in isolation and
// passes in a suite, which is the worst way round.

const READY = 120_000;

/** A hierarchy badge: "12 / 117" beside a pathway name. */
const BADGE = '.tree-node .analysis';

/** Run the gene-list analysis over the built-in gene-name example. */
async function runGeneList(page: Page) {
  await page.goto('/PathwayBrowser?analysisTab=qualitative');
  await page.getByRole('button', { name: 'Gene Name' }).click({ timeout: READY });
  // Options, then Analysis: the wizard's own two steps.
  for (const wait of [2000, 0]) {
    await page.getByRole('button', { name: /^Next$/ }).click();
    if (wait) await page.waitForTimeout(wait);
  }
  await expect(page).toHaveURL(/[?&]analysis=/, { timeout: READY });
  await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
}

async function openTab(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click();
}

test.describe('Analysis results', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  test('hit counts sit beside pathway names, and the table carries FDR', async ({ page }) => {
    await runGeneList(page);

    // Every badge is "found / total", and found is never more than total.
    const badges = await page.locator(BADGE).allInnerTexts();
    expect(badges.length, 'pathways with a hit count').toBeGreaterThan(5);
    for (const badge of badges.slice(0, 10)) {
      const [found, total] = badge.split('/').map((part) => Number(part.trim()));
      expect(Number.isFinite(found) && Number.isFinite(total), `badge "${badge}"`).toBe(true);
      expect(found, `badge "${badge}"`).toBeLessThanOrEqual(total);
    }

    await openTab(page, 'Results');
    await expect(page.getByRole('columnheader', { name: /Entities FDR/i })).toBeVisible({
      timeout: 60_000,
    });
    // A column of numbers, not a column of blanks.
    const fdr = await page.locator('td:has(cr-expression-tag)').first().innerText();
    expect(fdr.trim(), 'an FDR value').toMatch(/\d/);
  });

  test('a filter changes the result set', async ({ page }) => {
    await runGeneList(page);
    await openTab(page, 'Results');

    const rows = page.locator('cr-result-tab table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const before = await rows.count();
    expect(before, 'pathways before filtering').toBeGreaterThan(20);

    // The FDR slider rather than the Diseases toggle or a species facet: the
    // toggle changes a total the page does not show, and the species facet is
    // disabled for a human gene list because there is nothing to choose between.
    await page.locator('cr-result-tab button:has(mat-icon:text("filter_alt"))').first().click();
    const fdr = page.locator('.mat-mdc-menu-panel input[type="range"]').first();
    await fdr.focus();
    // Arrow keys, because a mat-slider thumb is not filled like an input.
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
    }
    expect(await fdr.inputValue(), 'the strictest FDR').toBe('0');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    const after = await rows.count();
    expect(after, 'a stricter FDR keeps fewer pathways').toBeLessThan(before);
    expect(after, 'but not none of them').toBeGreaterThan(0);
  });

  test('the result files download', async ({ page }) => {
    await runGeneList(page);
    await openTab(page, 'Download');

    for (const [label, looksRight] of [
      ['CSV Result', (bytes: Buffer) => bytes.toString('utf8', 0, 200).includes(',')],
      // Served gzipped, so check the gzip magic rather than the JSON.
      ['JSON Result', (bytes: Buffer) => bytes[0] === 0x1f && bytes[1] === 0x8b],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        page.getByText(label, { exact: true }).click(),
      ]);
      const bytes = readFileSync(await (download as Download).path());
      expect(bytes.length, `${label} size`).toBeGreaterThan(100);
      expect(looksRight(bytes), `${label} content`).toBe(true);
    }
  });

  test('species comparison overlays the pathways', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=species');
    await page.getByText('M. musculus').first().click({ timeout: READY });
    await page.getByRole('button', { name: /^Next$/ }).click();

    await expect(page).toHaveURL(/[?&]analysis=/, { timeout: READY });
    await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
    expect((await page.locator(BADGE).count()) > 5, 'pathways carrying a comparison').toBe(true);
  });

  test('tissue distribution overlays the pathways', async ({ page }) => {
    await page.goto('/PathwayBrowser?analysisTab=tissue');
    await page.getByText('Colon', { exact: true }).click({ timeout: READY });
    // The chevron between the two lists moves the selection across.
    await page
      .locator('.arrow, [class*="forward"], mat-icon')
      .filter({ hasText: /double_arrow|fast_forward/ })
      .first()
      .click({ timeout: 15_000 })
      .catch(() => {});
    await page.getByRole('button', { name: /^Next$/ }).click();

    await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
  });
});

test.describe('Analysis summary', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  /** Answers every summary request with text naming which request it was. */
  async function stubSummaries(page: Page) {
    let asked = 0;
    await page.route('**/analysis-summary', async (route) => {
      asked += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'event: start\ndata: {"release": "97", "analysis_type": "OVERREPRESENTATION", "disclosure": "aggregate"}\n\n' +
          `event: token\ndata: {"text": "Summary number ${asked}."}\n\n` +
          'event: done\ndata: {"state": "summarised"}\n\n',
      });
    });
  }

  // The service holding a summary is a singleton; the panel showing it is
  // destroyed whenever the analysis form opens. The first fix compared tokens
  // inside the panel, so the fresh panel under the second result had nothing to
  // compare with and showed the first result's summary above it.
  test('a summary never appears above a different result, and can be closed', async ({ page }) => {
    await stubSummaries(page);
    await runGeneList(page);
    await openTab(page, 'Results');
    await page.getByRole('button', { name: 'Summarise this result' }).click({ timeout: 60_000 });
    await expect(page.getByText('Summary number 1.')).toBeVisible({ timeout: 30_000 });
    const first = new URL(page.url()).searchParams.get('analysis');

    // A second analysis, in the same page, through the form.
    await page.getByRole('button', { name: 'Analyze' }).click();
    // The form reopens on its last step; the data is two steps back.
    await page.getByRole('tab', { name: /Data/ }).click({ timeout: READY });
    await page.getByRole('button', { name: 'UniProt IDs' }).click({ timeout: READY });
    await page.getByRole('button', { name: /^Next$/ }).click();
    // With interactors, so the request differs from the first by URL: the
    // recordings keep no request bodies, and two submissions to one URL would
    // replay as the same result.
    const interactors = page.locator('.card-checkbox', { hasText: 'IntAct interactors' });
    await interactors.click();
    await expect(interactors).toHaveClass(/\bchecked\b/);
    await page.getByRole('button', { name: /^Next$/ }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('analysis'), { timeout: READY })
      .not.toBe(first);
    await expect(page.locator(BADGE).first()).toBeVisible({ timeout: READY });
    await openTab(page, 'Results');

    await expect(page.locator('cr-result-tab')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Summary number 1.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Summarise this result' })).toBeVisible();

    await page.getByRole('button', { name: 'Summarise this result' }).click();
    await expect(page.getByText('Summary number 2.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Close summary' }).click();
    await expect(page.getByText('Summary number 2.')).toHaveCount(0);
    // Closing leaves the results where they were, and the offer to summarise.
    await expect(page.getByRole('columnheader', { name: /Entities FDR/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Summarise this result' })).toBeVisible();
  });
});

test.describe('Continuing a summary in the chat', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  // The chat opens on the summary the reader saw, at the tier they saw it, in a
  // new tab -- so the results stay put and a follow-up question has context.
  test('opens the chat on this summary, in a new tab', async ({ page, context }) => {
    let summarised: unknown = null;
    await page.route('**/analysis-summary', (route) => {
      summarised = route.request().postDataJSON()?.token;
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'event: start\ndata: {"release": "97", "analysis_type": "OVERREPRESENTATION", "disclosure": "aggregate"}\n\n' +
          'event: token\ndata: {"text": "A summary to continue."}\n\n' +
          'event: done\ndata: {"state": "summarised"}\n\n',
      });
    });
    let minted: Record<string, unknown> | null = null;
    await page.route('**/chat-handoff', async (route) => {
      minted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ path: '/chat/guest/#handoff=sum456', expires_in: 900 }),
      });
    });
    await context.route('**/chat/guest/**', (route) =>
      route.fulfill({ status: 200, body: 'chat' })
    );

    await runGeneList(page);
    await openTab(page, 'Results');
    await page.getByRole('button', { name: 'Summarise this result' }).click({ timeout: 60_000 });
    const continueButton = page.getByRole('button', { name: 'Continue in chat' });
    await expect(continueButton).toBeVisible({ timeout: 30_000 });

    const [tab] = await Promise.all([context.waitForEvent('page'), continueButton.click()]);
    await expect.poll(() => tab.url()).toMatch(/\/chat\/guest\/#handoff=sum456$/);
    // The chat finds the summary by its token, so the handoff must name the
    // analysis exactly as the summary request did.
    expect(summarised).toBeTruthy();
    expect(minted).toEqual({ kind: 'analysis', token: summarised, disclosure: 'aggregate' });
  });
});

test.describe('Continuing a summary after the person-check lapsed', () => {
  test.describe.configure({ timeout: 6 * 60 * 1000 });

  // The check lasts thirty minutes. Past that the handoff is refused, and
  // summarising again from this page's cache would not bring the check back --
  // so the reader looped. The challenge has to come up where they are.
  test('brings up the check instead of a dead end', async ({ page, context }) => {
    let summaries = 0;
    await page.route('**/analysis-summary', (route) => {
      summaries += 1;
      return summaries === 1
        ? route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body:
              'event: start\ndata: {"release": "97", "analysis_type": "OVERREPRESENTATION", "disclosure": "aggregate"}\n\n' +
              'event: token\ndata: {"text": "A summary to continue."}\n\n' +
              'event: done\ndata: {"state": "summarised"}\n\n',
          })
        : route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
              sitekey: '1x00000000000000000000AA',
              verify: '/search-answer/verify',
            }),
          });
    });
    await page.route('**/chat-handoff', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: '{"reason": "stale_human"}',
      })
    );
    await page.route('**/challenges.cloudflare.com/**', (route) => route.abort());

    await runGeneList(page);
    await openTab(page, 'Results');
    await page.getByRole('button', { name: 'Summarise this result' }).click({ timeout: 60_000 });
    const continueButton = page.getByRole('button', { name: 'Continue in chat' });
    await expect(continueButton).toBeVisible({ timeout: 30_000 });
    await Promise.all([context.waitForEvent('page'), continueButton.click()]);

    // The check itself, where the reader is -- it replaces the summary while
    // the summary is asked for again.
    await expect(page.locator('cr-analysis-summary .challenge')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/One quick check that you are a person/)).toBeVisible();
    expect(summaries).toBe(2);
  });
});

test.describe('A result that cannot be loaded', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  // It used to vanish: the token was dropped from the address and nothing was
  // said. Beta's quantitative analyses ended there, because ReactomeGSA writes
  // them to a different Analysis Service from the one beta reads.
  test('says so, instead of showing nothing', async ({ page }) => {
    await page.route('**/AnalysisService/token/**', (route) =>
      route.fulfill({ status: 410, contentType: 'application/json', body: '{"code":410}' })
    );
    await page.goto('/PathwayBrowser/R-HSA-109582?analysis=MjAyNjA5MjUxMjAwMDBfMQ%3D%3D');
    await expect(page.getByText(/analysis result is not available on this server/)).toBeVisible({
      timeout: READY,
    });
    await expect(page).not.toHaveURL(/[?&]analysis=/);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText(/analysis result is not available on this server/)).toHaveCount(0);
  });
});
