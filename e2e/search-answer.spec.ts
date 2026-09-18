/**
 * The React-to-Me answer panel on the search page.
 *
 * The stream is stubbed from the documented event format rather than fetched.
 *
 * The endpoint is live on beta as of 18 Sep 2026 -- it was 405 with `allow: GET`
 * that morning, Chainlit's SPA catch-all -- but a stub is still the right shape
 * here, for three reasons. The outcomes worth asserting are `nothing_found`, a
 * `state` outside the contract, and a dropped connection, and a live endpoint
 * produces none of them on demand. A real call costs a model call and about ten
 * seconds. And a real call now requires a solved Turnstile challenge, so it
 * would assert nothing about the panel without driving Cloudflare's widget.
 *
 * The panel is only offered by deployments whose profile carries
 * `searchAnswerEndpoint` -- `development` and `beta` today, not the public
 * site. `__APP_ENV` is the
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
  // Real answers end with their own plain-text Sources list. We render the
  // citation events instead, with links, so this copy must not also appear.
  'event: token\ndata: {"text": "\\n\\n### Sources\\n- Deregulated CDK5 triggers tau hyperphosphorylation"}',
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
const askButton = (page: Page) => page.getByRole('button', { name: /Ask React-to-Me/ });

test.describe('Search page React-to-Me answer', () => {
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

  test("shows one source list, linked, not the model's plain-text copy as well", async ({
    page,
  }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, ANSWERED);
    await openSearch(page);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });

    // Reported from use: the panel showed the model's "### Sources" list and
    // ours underneath, so two lists, one of them unclickable, and a visibly
    // longer panel. Exactly one heading, and its entries are links.
    await expect(panel(page).getByRole('heading', { name: /sources/i })).toHaveCount(1);
    await expect(panel(page).locator('.search-answer__chip')).not.toHaveCount(0);
    // The stripped copy is gone: the name now appears only inside a link.
    const plainMentions = await panel(page)
      .locator('.search-answer__prose')
      .getByText(/Deregulated CDK5/)
      .count();
    expect(plainMentions, 'the prose no longer carries its own source list').toBe(0);
  });

  test('offers a way to carry the question into the chat', async ({ page }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, ANSWERED);
    await openSearch(page);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });

    // The panel answers once and cannot take a follow-up; the chat can.
    const onward = panel(page).getByRole('link', { name: /continue in react-to-me/i });
    // `/chat/guest/`, not `/chat/`: the latter is a chooser page, so it lands
    // the reader a step short of an actual conversation.
    await expect(onward).toHaveAttribute('href', '/chat/guest/');
  });

  test('shows no sources heading when an answer has no citations', async ({ page }) => {
    await asDevelopmentProfile(page);
    // Zero citations is an ordinary good answer, not a failure, and an empty
    // "Sources" heading over nothing is the obvious way to get it wrong.
    // Userguide questions returned none at all until the chatbot began sending
    // `url` citations on 18 Sep; they now cite their pages, so this is rarer
    // than it was -- which is exactly why it wants a test rather than a
    // question someone remembers to try.
    await stubAnswer(
      page,
      stream([
        'event: start\ndata: {"release": 97, "answered": true}',
        'event: token\ndata: {"text": "Open the pathway browser from the toolbar."}',
        'event: done\ndata: {"state": "answered", "seconds": 3.3}',
      ])
    );
    await openSearch(page);

    await askButton(page).click();

    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toContainText('Open the pathway browser');
    await expect(panel(page).locator('.search-answer__sources')).toHaveCount(0);
    await expect(page.getByText(/most relevant sources/i)).toHaveCount(0);
  });

  test('shows progress while waiting, not a blank pause', async ({ page }) => {
    await asDevelopmentProfile(page);
    // Held open, so the waiting state is observable. Ten seconds of nothing is
    // the thing this exists to avoid.
    await page.route(ENDPOINT, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ANSWERED });
    });
    await openSearch(page);

    await askButton(page).click();

    const waiting = page.locator('.search-answer__waiting');
    await expect(waiting).toBeVisible({ timeout: 10_000 });
    await expect(waiting).toContainText('Reading Reactome');
    // A moving bar, so the reader can see work is happening. It deliberately
    // does not claim a percentage: the spread by question type is 3.3s to 20s+,
    // so a filling bar would stall visibly on the slow ones.
    await expect(waiting.locator('.search-answer__progress')).toBeVisible();
    // The elapsed count is measured rather than estimated, and is what makes a
    // long wait legible.
    await expect(waiting).toContainText(/\ds —/, { timeout: 6_000 });

    // And it gives way to the answer rather than lingering.
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await expect(waiting).toHaveCount(0);
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

  test('follows the dark theme rather than staying light', async ({ page }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, ANSWERED);
    await openSearch(page);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });

    // Reported from actually using it: in inverted colours the panel stayed a
    // light box with light text. The cause was invented CSS variable names --
    // nothing defined `--favth-color-bg`, so every value was its hardcoded
    // light fallback. Asserting the colours *change* pins that the panel reads
    // the site's tokens, without pinning what the theme's colours are.
    const read = () =>
      panel(page).evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, text: style.color };
      });

    const light = await read();
    await page.evaluate(() => document.body.classList.add('dark'));
    const dark = await read();

    expect(dark.background, 'panel background follows the theme').not.toBe(light.background);
    expect(dark.text, 'panel text follows the theme').not.toBe(light.text);
  });

  test("does not leave one query's answer above another query's results", async ({ page }) => {
    await asDevelopmentProfile(page);
    await stubAnswer(page, ANSWERED);
    await openSearch(page);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });

    // Searching again from the bar, as a reader would. The page reuses this
    // component across searches -- `onQueryInput` clears `searchSubmitted`
    // without a `markForCheck`, and the page is zoneless, so the `@if` around
    // the panel is never re-evaluated and the component is never destroyed.
    //
    // Before the fix this left the first query's answer sitting above the
    // second query's results, with no button to ask about the new one. A reader
    // could read an answer about apoptosis believing it was about TP53.
    const box = page.locator('textarea.search-input');
    await box.fill('TP53');
    await box.press('Enter');

    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'), { timeout: 20_000 })
      .toBe('TP53');
    await expect(page.locator('.result-count')).toContainText('TP53', { timeout: BOOT });

    // The stale answer is gone, and the invitation is back for the new query.
    await expect(panel(page)).toHaveCount(0);
    await expect(askButton(page)).toBeVisible({ timeout: 20_000 });
    await expect(askButton(page)).toContainText('TP53');
  });

  test('asks the reader to prove they are human, then answers', async ({ page }) => {
    await asDevelopmentProfile(page);

    // Cloudflare's widget is stubbed rather than loaded: the point here is our
    // own loop -- refusal, challenge, exchange, retry -- not Cloudflare's
    // rendering, and an e2e that reached out to them would be testing their
    // uptime.
    await page.addInitScript(() => {
      (window as unknown as { turnstile: unknown }).turnstile = {
        render: (el: HTMLElement, options: { callback: (token: string) => void }) => {
          el.textContent = 'stub widget';
          setTimeout(() => options.callback('solved-token'), 50);
          return 'stub';
        },
      };
    });

    let verified = false;
    let answerCalls = 0;
    await page.route('**/search-answer/verify', async (route) => {
      const body = route.request().postDataJSON();
      verified = body?.captchaToken === 'solved-token';
      await route.fulfill({ status: verified ? 204 : 400, body: '' });
    });
    await page.route('**/search-answer', (route) => {
      answerCalls += 1;
      // Refused until verified, exactly as the proxy behaves with the gate on.
      return verified
        ? route.fulfill({ status: 200, contentType: 'text/event-stream', body: ANSWERED })
        : route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
              detail: 'Verification required',
              verify: '/search-answer/verify',
              sitekey: '1x00000000000000000000AA',
            }),
          });
    });

    await openSearch(page);
    await askButton(page).click();

    // The challenge appears instead of an answer, and no answer has been given.
    await expect(page.locator('.search-answer__challenge')).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toHaveCount(0);

    // The widget solves, the exchange happens, and the question is asked again.
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toContainText('CDK5 bound to p25');
    await expect(page.locator('.search-answer__challenge')).toHaveCount(0);
    expect(answerCalls, 'asked once before the challenge and once after').toBe(2);
  });

  test('is absent entirely on a deployment that does not offer answers', async ({ page }) => {
    // Names a profile explicitly rather than leaving it alone, because a run
    // with no override proves nothing: it would pass whenever the panel is
    // missing for *any* reason, including the code not being present at all.
    // That is not hypothetical -- it is what happened here, and the reason is
    // recorded in the file header.
    //
    // `production` rather than `beta`: beta now carries the endpoint, because
    // beta is where this is reviewed. This test named beta until that changed,
    // at which point it failed -- correctly, and it is why the assertion has to
    // name a deployment that genuinely does not offer answers. Production is
    // that deployment, and it is the one where a panel appearing by accident
    // would matter most.
    await page.addInitScript(() => {
      (window as Window & { __APP_ENV?: string }).__APP_ENV = 'production';
    });
    await stubAnswer(page, ANSWERED);
    await openSearch(page);

    await expect(askButton(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});
