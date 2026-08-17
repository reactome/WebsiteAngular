import { test, expect } from '@playwright/test';

// Coverage for the content pages and shared navigation chrome.
//
// These exist because the rest of the suite reported 24/24 green while the
// sidebar and breadcrumbs rendered completely empty: nothing exercised those
// pages, so a whole class of breakage was invisible. Each component here builds
// its state in an async callback (route params, HTTP, or a dynamic import) and
// then renders it, which is exactly the pattern that fails silently when
// Angular is not told the state changed -- a stale view throws no error.
//
// Every assertion below is on real content arriving from the backend or the
// CMS, not on a container element existing, so an empty render fails.

const LOAD = 45_000;

test.describe('Shared navigation chrome', () => {
  // sidebar.component.ts and breadcrumb.component.ts build their items from
  // route segments combined with the asynchronously loaded nav options.
  for (const { url, minItems, minCrumbs } of [
    { url: '/documentation/userguide', minItems: 5, minCrumbs: 2 },
    { url: '/about/news', minItems: 5, minCrumbs: 2 },
  ]) {
    test(`sidebar and breadcrumbs populate on ${url}`, async ({ page }) => {
      await page.goto(url);
      const items = page.locator('app-sidebar a, app-sidebar li');
      await expect(items.first()).toBeVisible({ timeout: LOAD });
      expect(await items.count()).toBeGreaterThanOrEqual(minItems);

      const crumbs = page.locator('app-breadcrumb a, app-breadcrumb span');
      expect(await crumbs.count()).toBeGreaterThanOrEqual(minCrumbs);
    });
  }
});

test.describe('Content pages render backend data', () => {
  test('data schema lists classes with instance counts', async ({ page }) => {
    // schema.component.ts carries the most async-assigned state in the app.
    await page.goto('/content/schema');
    await expect(page.getByText('DatabaseObject').first()).toBeVisible({ timeout: LOAD });
    // Counts come from the content service; their presence proves real data.
    await expect(page.locator('body')).toContainText(/\[\s*\d[\d,]*\s*\]|\d[\d,]*\s+instances/, {
      timeout: LOAD,
    });
  });

  // ToC, DOI and Contributors read /data/content/* on the content service.
  // Those endpoints exist only on the dev host, from an unmerged backend branch
  // -- production still 404s them. Skip rather than fail where they are absent,
  // so a red run always means a real regression. Checked once per worker.
  let contentEndpoints: boolean | undefined;
  test.beforeEach(async ({ request, baseURL }) => {
    if (contentEndpoints === undefined) {
      try {
        const res = await request.get(`${baseURL}/ContentService/data/content/toc`, {
          timeout: 30_000,
        });
        contentEndpoints = res.ok();
      } catch {
        contentEndpoints = false;
      }
    }
  });

  test('table of contents lists pathways', async ({ page }) => {
    test.skip(!contentEndpoints, 'content-page endpoints absent on this backend');
    await page.goto('/content/toc');
    await expect(
      page.getByText(/Metabolism|Signal Transduction|Immune System/).first()
    ).toBeVisible({
      timeout: LOAD,
    });
  });

  test('DOI page lists pathways', async ({ page }) => {
    test.skip(!contentEndpoints, 'content-page endpoints absent on this backend');
    await page.goto('/content/doi');
    // Every row is a DOI-registered pathway; the prefix is stable.
    await expect(page.getByText(/10\.\d{4,}/).first()).toBeVisible({ timeout: LOAD });
  });

  test('contributors page lists people', async ({ page }) => {
    test.skip(!contentEndpoints, 'content-page endpoints absent on this backend');
    await page.goto('/community/contributors');
    const links = page.locator('a[href*="/content/detail/person/"]');
    await expect(links.first()).toBeVisible({ timeout: LOAD });
  });

  test('icon library lists icons', async ({ page }) => {
    await page.goto('/community/icon-lib');
    await expect(page.locator('img, svg').first()).toBeVisible({ timeout: LOAD });
    await expect(page.locator('body')).not.toContainText('Loading', { timeout: LOAD });
  });

  test('a CMS article page renders its body', async ({ page }) => {
    // page.component.ts fetches the compiled content JSON and renders markdown.
    await page.goto('/documentation/userguide');
    const main = page.locator('app-page, article, main').first();
    await expect(main).toBeVisible({ timeout: LOAD });
    // Poll rather than read once: the element is visible as soon as the page
    // shell renders, which is before the body has been fetched and converted
    // from markdown. Reading innerText immediately races that and fails
    // intermittently for a page that is in fact fine.
    await expect
      .poll(async () => (await main.innerText()).trim().length, { timeout: LOAD })
      .toBeGreaterThan(200);
  });

  test('release calendar renders entries', async ({ page }) => {
    await page.goto('/about/release-calendar');
    await expect(page.getByText(/20\d\d/).first()).toBeVisible({ timeout: LOAD });
  });
});

test.describe('In-page table of contents', () => {
  // The long userguide pages open with a table of contents linking each
  // section. Those ids are added at render time by addAnchorIds; the call was
  // once dropped from page.component while its import stayed, which left every
  // one of these links dead with nothing failing. Assert the jump itself, not
  // just that the ids exist, so the render pipeline and the click handler in
  // app.component are both covered.
  const PAGE = '/documentation/userguide/reactome-fiviz';

  test('section headings receive ids for their table-of-contents links', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#Overview')).toHaveCount(1, { timeout: LOAD });
    // MediaWiki-encoded anchor: the heading is "Gene Set/Mutation Analysis".
    await expect(page.locator('#Gene_Set\\.2FMutation_Analysis')).toHaveCount(1);
  });

  test('clicking a table-of-contents link scrolls to that section', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#Overview')).toHaveCount(1, { timeout: LOAD });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.locator('a[href="#Gene_Set.2FMutation_Analysis"]').first().click();

    // The heading should come to rest within the viewport, not merely end up
    // somewhere below. Poll rather than measure once: the scroll is smooth, so
    // reading the offset the moment scrollY passes 200 catches it mid-flight
    // whenever the machine is loaded.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Math.abs(
              document.getElementById('Gene_Set.2FMutation_Analysis')!.getBoundingClientRect().top
            )
          ),
        { timeout: 15_000 }
      )
      .toBeLessThan(150);
  });

  test('a deep-linked anchor lands on the section', async ({ page }) => {
    await page.goto(PAGE + '#Gene_Set.2FMutation_Analysis');
    await expect(page.locator('#Gene_Set\\.2FMutation_Analysis')).toHaveCount(1, { timeout: LOAD });
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeGreaterThan(200);
  });
});

test.describe('Site navigation chrome', () => {
  // The header and the footer's links were commented out of AppComponent in May
  // "updates to home page design/layout" -- to hide them on the curator build,
  // which removed them from the public site too. Nothing failed, because
  // nothing asserted they were there.
  test('every page outside the pathway browser has the header and footer', async ({ page }) => {
    for (const url of ['/', '/content/toc', '/documentation/userguide']) {
      await page.goto(url);
      await expect(page.locator('app-navigation-bar')).toHaveCount(1, { timeout: LOAD });

      // Assert the menus, not just the bar: a render error in the template once
      // left the bar present and completely empty.
      const menus = page.locator('app-navigation-bar .nav-link');
      await expect(menus.first()).toBeVisible({ timeout: LOAD });
      expect(await menus.count()).toBeGreaterThanOrEqual(5);

      // The footer carries the site's link directory, not just social icons.
      expect(await page.locator('app-info-footer a').count()).toBeGreaterThan(20);
    }
  });

  test('Data Schema sits under the Content menu', async ({ page }) => {
    await page.goto('/');
    const content = page
      .locator('app-navigation-bar li.nav-item')
      .filter({ hasText: 'Content' })
      .first();
    await expect(content).toBeVisible({ timeout: LOAD });
    await content.hover();

    const items = content.locator('.dropdown-link');
    await expect(items.filter({ hasText: 'Data Schema' })).toHaveCount(1, { timeout: 10_000 });
    await expect(items.filter({ hasText: 'Table of Contents' })).toHaveCount(1);
  });

  test('the pathway browser has no site header', async ({ page }) => {
    await page.goto('/PathwayBrowser/R-HSA-109606');
    await expect(page.locator('cr-viewport')).toBeAttached({ timeout: LOAD });
    await expect(page.locator('app-navigation-bar')).toHaveCount(0);
  });
});
