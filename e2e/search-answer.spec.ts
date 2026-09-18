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
 * these tests select it rather than depending on which configuration the server
 * was built with.
 *
 * **Run these with `E2E_PORT` set**, as `scripts/preflight.sh` does. Without it
 * playwright reuses whatever is already serving on :4200, and on this host that
 * is a deployed build (#243). While this spec was being written, that meant the
 * suite tested a deployed artifact rather than the working tree: it passed
 * against a build that happened to contain this panel, then reported six
 * failures the moment that build was replaced by one without it. Neither result
 * said anything about the code under test.
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
    // Anchored on the element rather than the sentence: the copy has already
    // been reworded once, and a test that pins prose fails for a wording change
    // while saying nothing about behaviour.
    await expect(panel(page).locator('.search-answer__incomplete')).toBeVisible();
    await expect(panel(page)).toContainText('stopped early');
  });

  test('says the ask completed when there is no answer, rather than leaving a dead button', async ({
    page,
  }) => {
    let calls = 0;
    await asDevelopmentProfile(page);
    await page.route(ENDPOINT, (route) => {
      calls += 1;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: NOTHING_FOUND });
    });
    await openSearch(page);

    await askButton(page).click();

    // No panel -- that part of D4 holds. But the click has to have visibly done
    // something, and the invitation must not come back for a question whose
    // answer is settled: a second click would hit the cache before `asking` is
    // set and change nothing at all on screen.
    await expect(page.locator('.search-answer__none')).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toHaveCount(0);
    await expect(askButton(page)).toHaveCount(0);
    expect(calls, 'asked exactly once').toBe(1);
  });

  test('keeps the invitation after a failure, which is a fault rather than an answer', async ({
    page,
  }) => {
    await asDevelopmentProfile(page);
    // A proxy or network fault: not the contract's 200-with-a-state, so not a
    // settled property of the question. Asking again is worth offering, and
    // `failed` is deliberately not cached so that it really re-asks.
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 502, body: 'bad gateway' }));
    await openSearch(page);

    await askButton(page).click();

    await expect(askButton(page)).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.search-answer__none')).toHaveCount(0);
  });

  test('is absent entirely on a deployment that does not offer answers', async ({ page }) => {
    // Names `beta` explicitly rather than leaving the profile alone, because a
    // run with no override proves nothing: it would pass whenever the panel is
    // missing for *any* reason, including the code not being present at all.
    // That is not hypothetical -- it is what happened here, and the reason is
    // recorded in the file header.
    //
    // beta is the profile this matters for: it is the curator-facing deployment,
    // it has no `searchAnswerEndpoint`, and until the real exchange lands every
    // call there would answer `refused`. Absence is what it must show, and it
    // must show it because of the profile rather than by accident.
    await page.addInitScript(() => {
      (window as Window & { __APP_ENV?: string }).__APP_ENV = 'beta';
    });
    await stubAnswer(page, ANSWERED);
    await openSearch(page);

    await expect(askButton(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});
