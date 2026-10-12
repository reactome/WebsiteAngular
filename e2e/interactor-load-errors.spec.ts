import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * Interactors that cannot be drawn say so on the diagram.
 *
 * Every interactor request was subscribed without an error handler: a failed
 * one left the diagram as it was, with an uncaught error in the console and
 * nothing for the reader. A link naming an overlay that does not exist -- a
 * typo, or an upload's token copied wrong -- is asked for as an upload, and
 * that 404 went the same way.
 */

const PATHWAY = 'R-HSA-69620';
const LOAD = 60_000;

function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

const banner = (page: Page) => page.locator('cr-diagram cr-flag-banner');

test('a link to an overlay that does not exist says so', async ({ page }) => {
  const thrown = collectThrown(page);
  await page.goto(`/PathwayBrowser/${PATHWAY}?overlay=nosuchoverlay`);
  await expect(banner(page)).toContainText('There is no interactor overlay "nosuchoverlay"', {
    timeout: LOAD,
  });
  expect(thrown).toEqual([]);
});

test('interactors that cannot be loaded say so', async ({ page }) => {
  const thrown = collectThrown(page);
  await page.route('**/interactors/static/molecules/details', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":500}' })
  );
  await page.goto(`/PathwayBrowser/${PATHWAY}?overlay=IntAct`);
  await expect(banner(page)).toContainText("Couldn't load the interactors from IntAct", {
    timeout: LOAD,
  });
  expect(thrown).toEqual([]);
});
