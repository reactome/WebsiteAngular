import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A request that fails is not an answer of "nothing".
 *
 * The person page said "Person not found" whatever went wrong, and turned a
 * failed list of contributions into an empty one, so a server error read as a
 * contributor who had authored and reviewed nothing. Only a 404 means that.
 */

const LOAD = 60_000;
// Contributors to Cell Cycle Checkpoints (R-HSA-69620): the first authored
// it, the second has no authored or reviewed events at all.
const AUTHOR = '69596';
const NO_EVENTS = '141896';

const person = (id: string, list = '') =>
  new RegExp(`/data/person/${id}${list ? `/${list}` : ''}(\\?|$)`);

function answer(page: Page, url: RegExp, status: number) {
  return page.route(url, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: status }),
    })
  );
}

/** Anything Angular reports ("ERROR <error>"), and anything uncaught. */
function collectThrown(page: Page) {
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /^ERROR\b/.test(message.text())) thrown.push(message.text());
  });
  page.on('pageerror', (error) => thrown.push(String(error)));
  return thrown;
}

const heading = (page: Page) => page.locator('h1.person-name');

test.describe('The person page', () => {
  test('says a contributor who does not exist was not found', async ({ page }) => {
    await answer(page, person(NO_EVENTS), 404);
    await page.goto(`/content/detail/person/${NO_EVENTS}`);
    await expect(page.getByRole('heading', { name: 'Person not found' })).toBeVisible({
      timeout: LOAD,
    });
  });

  test('does not call a contributor it could not load "not found"', async ({ page }) => {
    const thrown = collectThrown(page);
    await answer(page, person(AUTHOR), 500);
    await page.goto(`/content/detail/person/${AUTHOR}`);
    await expect(page.getByRole('heading', { name: "Couldn't load this contributor" })).toBeVisible(
      {
        timeout: LOAD,
      }
    );
    await expect(page.getByText('Please try again later.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Person not found' })).toHaveCount(0);
    expect(thrown).toEqual([]);
  });

  test('says when some contributions could not be loaded, and shows the rest', async ({ page }) => {
    const thrown = collectThrown(page);
    await answer(page, person(AUTHOR, 'reviewedReactions'), 500);
    await page.goto(`/content/detail/person/${AUTHOR}`);
    await expect(heading(page)).toHaveText('Hoffmann, I', { timeout: LOAD });
    await expect(page.locator('.event-section', { hasText: 'Authored Pathways' })).toBeVisible({
      timeout: LOAD,
    });
    await expect(
      page.getByText(
        "Some of this contributor's pathways and reactions couldn't be loaded, so these lists may be incomplete. Please try again later."
      )
    ).toBeVisible();
    expect(thrown).toEqual([]);
  });

  test('says nothing when a list is simply not there', async ({ page }) => {
    // A backend without these lists answers 404: not a failure.
    await answer(page, person(AUTHOR, 'reviewedReactions'), 404);
    const answered = page.waitForResponse(person(AUTHOR, 'reviewedReactions'));
    await page.goto(`/content/detail/person/${AUTHOR}`);
    await answered;
    await expect(page.locator('.event-section', { hasText: 'Authored Pathways' })).toBeVisible({
      timeout: LOAD,
    });
    await expect(page.locator('.person-load-error')).toHaveCount(0);
  });

  test('names the contributor in the breadcrumb', async ({ page }) => {
    await page.goto(`/content/detail/person/${AUTHOR}`);
    await expect(heading(page)).toHaveText('Hoffmann, I', { timeout: LOAD });
    await expect(page.locator('app-breadcrumb')).toContainText('Hoffmann, I');
  });

  test("shows the contributor navigated to, not the previous one's late answers", async ({
    page,
  }) => {
    // The first contributor's answers arrive only after the second's.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let waiting = 0;
    let asked!: () => void;
    const askedFirst = new Promise<void>((resolve) => (asked = resolve));
    await page.route(new RegExp(`/data/person/${NO_EVENTS}(/[a-zA-Z]+)?(\\?|$)`), async (route) => {
      waiting++;
      asked();
      await held;
      // Once the page has cancelled a request there is nothing to answer.
      await route.fallback().catch(() => undefined);
      waiting--;
    });
    await page.goto(`/content/detail/person/${NO_EVENTS}`);
    // Only once the page is waiting for the first contributor.
    await askedFirst;
    await page.evaluate((id) => {
      history.pushState({}, '', `/content/detail/person/${id}`);
      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, AUTHOR);
    await expect(heading(page)).toHaveText('Hoffmann, I', { timeout: LOAD });
    const authored = page.locator('.event-section', { hasText: 'Authored Pathways' });
    await expect(authored).toBeVisible({ timeout: LOAD });

    // The breadcrumb's lookup of the first name is not cancelled: it is the
    // late answer that reaches the page.
    const lateName = page.waitForResponse(person(NO_EVENTS));
    release();
    // Every held answer, then two frames for them to be drawn.
    await expect.poll(() => waiting, { timeout: LOAD }).toBe(0);
    await lateName;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    await expect(heading(page)).toHaveText('Hoffmann, I');
    await expect(authored).toBeVisible();
    // Nor is the first contributor's name added to the breadcrumb.
    await expect(page.locator('app-breadcrumb')).toContainText('Hoffmann, I');
    await expect(page.locator('app-breadcrumb')).not.toContainText('Wang, X');
  });
});
