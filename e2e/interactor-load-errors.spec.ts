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

test('a failed resource is fetched again with one click, and the notice goes', async ({ page }) => {
  const thrown = collectThrown(page);
  // Failing until let through: opening the panel asks for the counts too.
  // Aborted rather than answered, so the recording holds only real answers:
  // a stubbed one for the same request would be replayed in their place.
  let failing = true;
  await page.route('**/interactors/static/molecules/details', async (route) => {
    if (failing) return route.abort('failed');
    return route.fallback();
  });
  await page.goto(`/PathwayBrowser/${PATHWAY}`);
  await page.locator('.species-interactor-container .interactor').click({ timeout: LOAD });
  const panel = page.locator('cr-interactors');
  await panel.getByRole('button', { name: 'IntAct' }).click();
  await expect(banner(page)).toContainText("Couldn't load the interactors from IntAct", {
    timeout: LOAD,
  });

  // Once: it was shown as chosen, so the first click put it away instead.
  failing = false;
  await panel.getByRole('button', { name: 'IntAct' }).click();
  await expect
    .poll(
      () =>
        page.evaluate<number>(`(() => {
          const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
          return cy ? cy.nodes('.InteractorOccurrences').length : 0;
        })()`),
      { timeout: LOAD }
    )
    .toBeGreaterThan(0);
  await expect(banner(page)).not.toContainText('interactors');
  expect(thrown).toEqual([]);
});

test('the notice is about the pathway on screen', async ({ page }) => {
  // A resource that failed is not put in the address, so nothing on the next
  // pathway asks for it again -- and nothing took its notice down.
  await page.route('**/interactors/psicquic/molecules/biogrid/details', (route) =>
    route.abort('failed')
  );
  // Two sibling pathways under Autophagy, each with a diagram of its own.
  await page.goto('/PathwayBrowser/R-HSA-9615710');
  await page.locator('.species-interactor-container .interactor').click({ timeout: LOAD });
  await page.locator('cr-interactors').getByRole('button', { name: 'BioGrid' }).click();
  await expect(banner(page)).toContainText("Couldn't load the interactors from BioGrid", {
    timeout: LOAD,
  });

  // Within the page, as the hierarchy or Back would: the router follows it.
  await page.evaluate(() => {
    history.pushState({}, '', '/PathwayBrowser/R-HSA-1632852');
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  });
  await expect(page).toHaveURL(/R-HSA-1632852/, { timeout: LOAD });
  await expect
    .poll(
      () =>
        page.evaluate<number>(`(() => {
          const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
          return cy ? cy.nodes().length : 0;
        })()`),
      { timeout: LOAD }
    )
    .toBeGreaterThan(0);
  await expect(banner(page)).not.toContainText('BioGrid');
});

test('a resource left behind cannot report on the one chosen after it', async ({ page }) => {
  // The reader chose MINT, then IntAct before MINT answered. MINT's late
  // failure put its notice over IntAct's interactors and stopped the spinner
  // of whatever was loading then: nothing checked that the answer was still
  // for the resource on screen.
  test.setTimeout(150_000);
  const thrown = collectThrown(page);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/interactors\/psicquic\/molecules\/mint\/details/i, async (route) => {
    await held;
    await route.abort('failed');
  });
  await page.goto(`/PathwayBrowser/${PATHWAY}`);
  await page.locator('.species-interactor-container .interactor').click({ timeout: LOAD });
  const panel = page.locator('cr-interactors');
  await panel.getByRole('button', { name: 'MINT' }).click();
  await panel.getByRole('button', { name: 'IntAct' }).click();
  const drawn = () =>
    page.evaluate<number>(`(() => {
      const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
      return cy ? cy.nodes('.InteractorOccurrences').length : 0;
    })()`);
  await expect.poll(drawn, { timeout: LOAD }).toBeGreaterThan(0);

  release();
  // Long enough for the late failure to have landed, had it been heard.
  await page.waitForTimeout(1_500);
  await expect(banner(page)).not.toContainText('MINT');
  expect(await drawn()).toBeGreaterThan(0);
  expect(thrown).toEqual([]);
});

test('a choice still being looked up cannot displace the one made after it', async ({ page }) => {
  // Choosing a PSICQUIC resource first asks for the resource list again, to
  // tell what kind it is, and nothing cancelled that: MINT's lookup landing
  // after IntAct was chosen cancelled IntAct and loaded MINT -- the resource
  // chosen last was the one dropped.
  test.setTimeout(150_000);
  const thrown = collectThrown(page);
  let lists = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/interactors/psicquic/resources/', async (route) => {
    lists += 1;
    // The panel's own list goes through; a lookup's waits.
    if (lists > 1) await held;
    await route.fallback();
  });
  await page.goto(`/PathwayBrowser/${PATHWAY}`);
  await page.locator('.species-interactor-container .interactor').click({ timeout: LOAD });
  const panel = page.locator('cr-interactors');
  await panel.getByRole('button', { name: 'MINT' }).click();
  await panel.getByRole('button', { name: 'IntAct' }).click();
  const drawn = () =>
    page.evaluate<number>(`(() => {
      const cy = document.querySelector('cr-diagram #cytoscape')?._cyreg?.cy;
      return cy ? cy.nodes('.InteractorOccurrences').length : 0;
    })()`);
  await expect.poll(drawn, { timeout: LOAD }).toBeGreaterThan(0);

  release();
  // Long enough for MINT's lookup, and its load had it started, to land.
  await page.waitForTimeout(3_000);
  await expect(page).toHaveURL(/overlay=IntAct/);
  await expect(page).not.toHaveURL(/overlay=MINT/);
  expect(await drawn()).toBeGreaterThan(0);
  expect(thrown).toEqual([]);
});
