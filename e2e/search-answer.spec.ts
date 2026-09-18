/**
 * The AI answer panel on the search page.
 *
 * The stream is stubbed from the documented event format rather than fetched.
 *
 * The endpoint is live on beta as of 18 Sep 2026 -- it was 405 with `allow: GET`
 * that morning, Chainlit's SPA catch-all -- but a stub is still the right shape
 * here, for three reasons. The outcomes worth asserting are `nothing_found`, a
 * `state` outside the contract, and a dropped connection, and a live endpoint
 * produces none of them on demand. A real call costs a model call and about ten
 * seconds. And until a keypair is exchanged every real call answers
 * `{"state": "refused"}` in 0.0s, so it would assert nothing about the panel.
 *
 * The panel is only offered by deployments whose profile carries
 * `searchAnswerEndpoint`, which today is `development` alone. `__APP_ENV` is the
 * documented runtime override for choosing a deployment without rebuilding, so
 * these tests select it rather than depending on which configuration `ng serve`
 * happened to use.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/backend';

const ENDPOINT = '**/search-answer';
// A query the recordings actually carry: `search.spec.ts` recorded apoptosis,
// TP53 and one nonexistent term, and the pooled fallback serves those GETs to
// any spec. A query with no recording gives an empty results page, and then
// every assertion here fails for a reason that has nothing to do with the panel.
const QUERY = 'apoptosis';
const BOOT = 45_000;

function stream(frames: string[]): string {
  return frames.map((frame) => `${frame}\n\n`).join('');
}

const ANSWERED = stream([
  'event: start\ndata: {"release": 97, "answered": true}',
  'event: token\ndata: {"text": "## CDK5\\n\\nCDK5 bound to p25 "}',
  'event: token\ndata: {"text": "phosphorylates tau."}',
  'event: citation\ndata: {"st_id": "R-HSA-8862803", "display_name": "Deregulated CDK5 triggers tau hyperphosphorylation"}',
  'event: done\ndata: {"state": "answered", "seconds": 8.4}',
]);

const NOTHING_FOUND = stream([
  'event: start\ndata: {"release": 97, "answered": false}',
  'event: done\ndata: {"state": "nothing_found", "seconds": 4.5}',
]);

async function asDevelopmentProfile(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { __APP_ENV?: string }).__APP_ENV = 'development';
  });
}

async function stubAnswer(page: Page, body: string) {
  await page.route(ENDPOINT, (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  );
}

async function openSearch(page: Page) {
  await page.goto(`/content/query?q=${QUERY}`, { waitUntil: 'domcontentloaded' });
  // The panel only appears once a search has actually returned results, so wait
  // for the count rather than for the button -- otherwise a missing panel and a
  // slow search look identical.
  await expect(page.locator('.result-count')).toBeVisible({ timeout: BOOT });
}

const panel = (page: Page) => page.locator('.search-answer__panel');
const askButton = (page: Page) => page.getByRole('button', { name: /Ask Reactome AI/ });

test.describe('Search page AI answer', () => {
  test('offers an answer but does not fetch one until asked', async ({ page }) => {
    let calls = 0;
    await page.route(ENDPOINT, (route) => {
      calls += 1;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ANSWERED });
    });
    await asDevelopmentProfile(page);
    await openSearch(page);

    await expect(askButton(page)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    // The whole reason the panel is opt-in: a crawled search URL must not cost a
    // model call, which is what lets the caller token stop claiming to prove
    // humanity.
    expect(calls, 'nothing is asked before the reader asks').toBe(0);
  });

  test('renders the prose and its sources once asked', async ({ page }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, ANSWERED);
    await openSearch(page);

    await askButton(page).click();

    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    // Both token events, joined -- a panel showing only the first would mean a
    // dropped chunk.
    await expect(panel(page)).toContainText('CDK5 bound to p25 phosphorylates tau.');
    // Markdown became a heading rather than being shown as literal "##".
    await expect(panel(page).locator('h2, h3').filter({ hasText: 'CDK5' }).first()).toBeVisible();

    const source = panel(page).getByRole('link', { name: /Deregulated CDK5/ });
    await expect(source).toHaveAttribute('href', '/content/detail/R-HSA-8862803');
  });

  test('renders nothing at all when the answer is nothing_found', async ({ page }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, NOTHING_FOUND);
    await openSearch(page);

    await askButton(page).click();

    // About one question in seven. An ordinary outcome, so no panel and no
    // error message either -- and the results must be untouched.
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.result-count')).toBeVisible();
    await expect(page.getByText(/no answer/i)).toHaveCount(0);
  });

  test('keeps prose that stopped early, and says it stopped', async ({ page }) => {
    await asDevelopmentProfile(page);
    // Tokens, then silence: what a dropped connection looks like.
    //
    // The text stays. The reader has been reading real retrieved prose, and
    // generation stopping does not make what arrived wrong -- withdrawing it
    // mid-read is the worse failure for a scientific resource. The panel says
    // so instead.
    await stubAnswer(
      page,
      stream([
        'event: start\ndata: {"release": 97, "answered": true}',
        'event: token\ndata: {"text": "CDK5 bound to p25 "}',
      ])
    );
    await openSearch(page);

    await askButton(page).click();

    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toContainText('CDK5 bound to p25');
    await expect(panel(page)).toContainText('stopped before it finished');
  });

  test('offers the invitation again when an outcome shows nothing', async ({ page }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, NOTHING_FOUND);
    await openSearch(page);

    await askButton(page).click();
    await expect(panel(page)).toHaveCount(0);

    // Hiding the button on "already asked" left the reader's click with no
    // visible effect at all and no way to retry. A repeat is free: every
    // outcome is cached, including this one.
    await expect(askButton(page)).toBeVisible({ timeout: 20_000 });
  });

  test('is absent entirely on a deployment that does not offer answers', async ({ page }) => {
    // Names `beta` rather than leaving the profile alone. `ng serve` defaults to
    // the development configuration, so an un-overridden run *does* offer the
    // panel -- this test passed vacuously against the wrong profile until that
    // showed up as a failure here.
    //
    // beta is the profile this matters for: it is the curator-facing deployment,
    // it has no `searchAnswerEndpoint`, and until a keypair is exchanged every
    // real call there would answer `refused`. Absence is what it must show.
    await page.addInitScript(() => {
      (window as Window & { __APP_ENV?: string }).__APP_ENV = 'beta';
    });
    await stubAnswer(page, ANSWERED);
    await openSearch(page);

    await expect(askButton(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});
