import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A search request that fails is not an answer of "nothing".
 *
 * Each of these used to turn a failure into less: a protein list short of the
 * batches that failed, a page of a group that stayed on the last one while its
 * number moved on, the website's pages missing from the results, and a contact
 * message thanked for although it was never sent.
 */

const LOAD = 60_000;

/** Anything Angular reports ("ERROR <error>"), and anything uncaught. */
function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

/** Fails the search requests asking for this many rows: 500 is a protein batch, 10 a group's page. */
function failSearchesOf(page: Page, rows: number) {
  return page.route(
    (url) =>
      url.pathname.endsWith('/ContentService/search/query') &&
      url.searchParams.get('rows') === String(rows),
    (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  );
}

test.describe('Search', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('says so when the protein list could not all be loaded', async ({ page }) => {
    const thrown = collectThrown(page);
    await failSearchesOf(page, 500);
    await page.goto('/content/query?q=TP53');
    const proteins = page
      .locator('.result-group')
      .filter({ has: page.getByRole('heading', { name: /^Protein\b/ }) });
    await expect(proteins.getByRole('alert')).toContainText(
      "Some proteins couldn't be loaded, so this list is incomplete.",
      { timeout: LOAD }
    );
    expect(thrown).toEqual([]);
  });

  test('stays on the page it shows when another page of a group fails', async ({ page }) => {
    const thrown = collectThrown(page);
    await page.goto('/content/query?q=apoptosis');
    const group = page
      .locator('.result-group')
      .filter({ has: page.locator('nav.group-pagination') })
      .filter({ hasNot: page.getByRole('heading', { name: /^Protein\b/ }) })
      .first();
    const pager = group.locator('nav.group-pagination');
    await expect(pager).toBeVisible({ timeout: LOAD });
    const shown = await group.locator('.search-entry').allTextContents();

    await failSearchesOf(page, 10);
    await pager.getByRole('button', { name: '2', exact: true }).click();
    await expect(group.getByRole('alert')).toContainText("Couldn't load that page of results.", {
      timeout: LOAD,
    });
    // The number says what is on screen: still the first page.
    await expect(pager.locator('.page-btn.active')).toHaveText('1');
    expect(await group.locator('.search-entry').allTextContents()).toEqual(shown);
    expect(thrown).toEqual([]);
  });

  test("says so when the website's pages could not be searched", async ({ page }) => {
    const thrown = collectThrown(page);
    await page.route('**/site-search-index.json', (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'failed' })
    );
    await page.goto('/content/query?q=apoptosis');
    await expect(page.getByRole('alert')).toContainText(
      "Couldn't search the website's pages, so only Reactome data is shown.",
      { timeout: LOAD }
    );
    // The data results are still there.
    await expect(page.locator('.result-group').first()).toBeVisible();
    expect(thrown).toEqual([]);
  });
});

test('search results ask only for icons that exist', async ({ page }) => {
  const thrown = collectThrown(page);
  const missing: string[] = [];
  page.on('response', (response) => {
    // A missing asset comes back as the site's own page, not an image.
    if (
      /\/assets\/icons\/.+\.svg$/.test(response.url()) &&
      (!response.ok() || !/svg/.test(response.headers()['content-type'] ?? ''))
    )
      missing.push(response.url());
  });
  // Its results include Reactome's icon library, a type of its own.
  await page.goto('/content/query?q=apoptosis');
  await expect(page.locator('.result-group').first()).toBeVisible({ timeout: LOAD });
  await page.waitForLoadState('networkidle');
  expect(missing).toEqual([]);
  expect(thrown).toEqual([]);
});

test.describe('The help form shown when nothing is found', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  /**
   * Opens the form with hCaptcha stood in for, already solved, and every
   * message to the help desk answered here: nothing is ever sent.
   */
  async function openForm(page: Page, status: number) {
    const posts: string[] = [];
    await page.route('https://js.hcaptcha.com/**', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.hcaptcha = {
          render(el, options) { setTimeout(() => options.callback('test-token')); return 1; },
          reset() {},
        };`,
      })
    );
    await page.route('**/ContentService/contact', (route) => {
      posts.push(route.request().method());
      return route.fulfill({ status, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/content/query?q=xyzzy_no_match_99999');
    const form = page.locator('#contact-form');
    await form.locator('input[name="mailAddress"]').fill('reader@example.org', { timeout: LOAD });
    await expect(form.getByRole('button', { name: 'Send' })).toBeEnabled();
    return { form, posts };
  }

  test('sends the message once', async ({ page }) => {
    const { form, posts } = await openForm(page, 200);
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Thank you for contacting us.')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(posts).toEqual(['POST']);
  });

  test('does not thank the reader for a message that was not sent', async ({ page }) => {
    const thrown = collectThrown(page);
    const { form } = await openForm(page, 500);
    const message = await form.locator('textarea#message').inputValue();
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(form.getByRole('alert')).toContainText(
      "Your message couldn't be sent. Please try again later, or email help@reactome.org.",
      { timeout: LOAD }
    );
    await expect(page.getByText('Thank you for contacting us.')).toHaveCount(0);
    // What they wrote is still there to send again.
    await expect(form.locator('textarea#message')).toHaveValue(message);
    expect(thrown).toEqual([]);
  });
});
