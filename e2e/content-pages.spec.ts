import { serves } from './fixtures/serves';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './support/backend';

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

  // ToC, DOI and Contributors read /data/content/* on the content service,
  // which node serves and Java's ContentService does not: production's still
  // 404s them. Skip rather than fail where they are absent, so a red run always
  // means a real regression.
  //
  // Asked by each test that needs them, not once per worker. A cached answer
  // came from whichever test ran first, and a test that never probes has no
  // recording of the probe -- so when sharding put the icon library first, it
  // read as absent and the four tests below skipped (#321).
  async function skipUnlessContentEndpoints(request: APIRequestContext, baseURL?: string) {
    // Not wrapped in try/catch on purpose: a backend without the endpoint
    // answers 404 and these tests stand down, but a timeout used to land here
    // too and quietly disabled all four for the whole run.
    const present = await serves(request, `${baseURL}/ContentService/data/content/toc`);
    test.skip(!present, 'content-page endpoints absent on this backend');
  }

  test('table of contents lists pathways', async ({ page, request, baseURL }) => {
    await skipUnlessContentEndpoints(request, baseURL);
    await page.goto('/content/toc');
    await expect(
      page.getByText(/Metabolism|Signal Transduction|Immune System/).first()
    ).toBeVisible({
      timeout: LOAD,
    });
  });

  test('a subpathway shows its DOI, which its parent does not carry', async ({
    page,
    request,
    baseURL,
  }) => {
    await skipUnlessContentEndpoints(request, baseURL);
    // This page asks for two lists, and under replay they are ~1 MB of recorded
    // JSON together (250 kB of contents, 796 kB of DOIs). Alone it takes about
    // 35 seconds, which used to exceed playwright's 30s default and report as a
    // timeout rather than as a failed assertion.
    //
    // No `test.slow()` any more: the per-test timeout is 60s in
    // playwright.config.ts, set there because `LOAD` in this file is 45s and
    // could never be reached under the old default. Fixed where the mismatch
    // was rather than here.

    // `/data/content/toc` sends three fields for a child -- stId, displayName,
    // speciesName -- and no `doi`, so the DOI link the template renders behind
    // `@if (sub.doi)` could never appear. That is not markup for a case that
    // never existed: production's own /content/toc carries 44 DOIs, and 41 of
    // them are subpathways. All but three were missing here.
    //
    // Autophagy is the case that shows it clearly. It has no DOI of its own,
    // and three of its children do, so a DOI appearing under it can only have
    // come from the join against /data/content/doi.
    await page.goto('/content/toc');
    const autophagy = page.locator('tr.pathway-row', { hasText: 'Autophagy' }).first();
    await expect(autophagy).toBeVisible({ timeout: LOAD });
    await autophagy.locator('button.expand-btn').click();

    const child = page.locator('tr', { hasText: 'Chaperone Mediated Autophagy' }).first();
    await expect(child).toBeVisible({ timeout: LOAD });
    await expect(child.locator('a.doi-link')).toHaveText(/10\.3180\/R-HSA-9613829/, {
      timeout: LOAD,
    });
  });

  test('DOI page lists pathways', async ({ page, request, baseURL }) => {
    await skipUnlessContentEndpoints(request, baseURL);
    await page.goto('/content/doi');
    // Every row is a DOI-registered pathway; the prefix is stable.
    await expect(page.getByText(/10\.\d{4,}/).first()).toBeVisible({ timeout: LOAD });
  });

  test('contributors page lists people', async ({ page, request, baseURL }) => {
    await skipUnlessContentEndpoints(request, baseURL);
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

test.describe('Authored page headings', () => {
  // page.component.html renders the frontmatter title as the page's h1, so a
  // page imported with `title: Untitled` showed "UNTITLED" as its heading.
  test('Digital Preservation is headed by its name', async ({ page }) => {
    await page.goto('/about/digital-preservation');
    await expect(page.locator('h1').first()).toHaveText('Digital Preservation', {
      timeout: LOAD,
    });
    await expect(page.locator('body')).not.toContainText(/untitled/i);
  });
});

test.describe('Release-stamped figures', () => {
  // The inferred-events chart was a copy of release 95's saved into the repo, so
  // it kept saying "Reactome Version 95" while the site served 97. The chart is
  // republished with every release; the page has to point at the current one.
  test("the inferred-events chart is the current release's", async ({ page }) => {
    await page.goto('/documentation/inferred-events');
    const chart = page.locator('app-page img[src*="reaction_release_stats"]');
    await expect(chart).toHaveAttribute(
      'src',
      /download\.reactome\.org\/\d+\/stats\/reaction_release_stats\.png$/,
      { timeout: LOAD }
    );
  });
});

test.describe('Links from news', () => {
  // Twenty-two release notes send readers to the documentation page's training
  // section. The heading had no id -- only headings the same page links to got
  // one -- so they landed at the top of a long page.
  test('the training section can be linked to from another page', async ({ page }) => {
    await page.goto('/documentation#Reactome_Training_Materials');
    await expect(page.locator('h3#Reactome_Training_Materials')).toBeInViewport({ timeout: LOAD });
  });

  // reactome.org/gsa was ReactomeGSA's separate landing page; its wizard is
  // built into the Pathway Browser here, and the news links go straight to it.
  test('an old link to ReactomeGSA opens the quantitative analysis', async ({ page }) => {
    await page.goto('/about/news/238-version-87-released');
    const link = page.locator('article a[href="PathwayBrowser?analysisTab=quantitative"]').first();
    await expect(link).toBeAttached({ timeout: LOAD });
    await expect(page.locator('article a[href*="reactome.org/gsa"]')).toHaveCount(0);
  });
});

test.describe('Research Spotlight', () => {
  // The list showed half its spotlights twice (40 scrape leftovers beside the
  // real articles), stopped at April 2026 while reactome.org had May and July,
  // and never said what a spotlight is.
  test('explains itself, starts with the newest, and lists each once', async ({ page }) => {
    await page.goto('/content/reactome-research-spotlight');
    const titles = page.locator('.news-card h2');
    await expect(titles.first()).toHaveText(
      'Ten common mistakes that could ruin your enrichment analysis',
      {
        timeout: LOAD,
      }
    );
    await expect(page.locator('.page-header')).toContainText('Each month, Reactome highlights');
    await expect(page.locator('.page-header a')).toHaveAttribute('href', '/');

    const all = (await titles.allInnerTexts()).map((t) => t.trim().toLowerCase());
    expect(all.length).toBeGreaterThanOrEqual(44);
    expect(all.filter((t, i) => all.indexOf(t) !== i)).toEqual([]);
    expect(all.some((t) => t.startsWith('central role of glycosylation'))).toBe(true);
  });

  test('the home page shows the newest one', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-spotlight-text').first()).toContainText(
      'Ten common mistakes that could ruin your enrichment analysis',
      { timeout: LOAD }
    );
  });
});

test.describe('When an article list fails to load', () => {
  // A failed index was turned into an empty list, so the home page said there
  // was no news, the news page said there were no articles, and the Spotlight
  // tile read the date of an article that did not exist and broke (#321).
  // Missing is still "none"; failing says so.
  const failIndex = (page: import('@playwright/test').Page, list: string) =>
    page.route(`**/content/${list}/index.json`, (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'index failed' })
    );

  test('the home page says news and the spotlight could not be loaded', async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (error) => crashes.push(error.message));
    await failIndex(page, 'about/news');
    await failIndex(page, 'content/reactome-research-spotlight');
    await page.goto('/');

    const news = page.locator('app-home-latest-news');
    await expect(news.getByRole('alert')).toContainText("Couldn't load the latest news", {
      timeout: LOAD,
    });
    await expect(news).not.toContainText('No news to show');
    await expect(page.locator('app-home-spotlight').getByRole('alert')).toContainText(
      "Couldn't load the research spotlight"
    );
    expect(crashes).toEqual([]);
  });

  test('the news page says the list could not be loaded', async ({ page }) => {
    await failIndex(page, 'about/news');
    await page.goto('/about/news');
    await expect(page.getByRole('alert')).toContainText("Couldn't load the news", {
      timeout: LOAD,
    });
    await expect(page.getByText('No news articles available')).toHaveCount(0);
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
          page.evaluate(() => {
            const heading = document.getElementById('Gene_Set.2FMutation_Analysis');
            // Report a value that fails the assertion rather than throwing, so a
            // missing heading reads as "never scrolled" instead of a crash.
            return heading
              ? Math.abs(heading.getBoundingClientRect().top)
              : Number.MAX_SAFE_INTEGER;
          }),
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

test.describe('Tools page', () => {
  // The Tools page is authored content, so its links did not get updated when
  // the Tools *menu* was fixed to use ?analysisTab=. It still pointed at
  // /gsa/home and /PathwayBrowser/#TOOL=AT, which are old-site URLs this app
  // never served -- the menu worked and the page it described did not.
  test('no card points at a URL this app does not serve', async ({ page }) => {
    await page.goto('/tools');
    const cards = page.locator('a.module-card');
    await expect(cards.first()).toBeVisible({ timeout: LOAD });

    for (const href of await cards.evaluateAll((els) =>
      els.map((e) => e.getAttribute('href') ?? '')
    )) {
      expect(href, `legacy tool URL still in the Tools page: ${href}`).not.toMatch(
        /gsa\/home|#TOOL=/
      );
    }
  });

  test('"Analyse Gene Expression" opens the quantitative analysis', async ({ page }) => {
    await page.goto('/tools');
    await page
      .locator('a.module-card')
      .filter({ hasText: 'Analyse Gene Expression' })
      .first()
      .click();

    await expect(page).toHaveURL(/analysisTab=quantitative/, { timeout: LOAD });
    await expect(page.locator('cr-viewport')).toBeAttached({ timeout: LOAD });
  });
});

test.describe('Entity detail: pathway locations', () => {
  // locationsInPWB exists on the dev content service but not on production's,
  // which answers 404 for every id -- so a CI run pointed at reactome.org has no
  // locations to render for anything. Probe once and skip rather than fail on a
  // backend that does not implement the endpoint.
  let locationsEndpoint: boolean | undefined;
  test.beforeAll(async ({ request, baseURL }) => {
    try {
      const res = await request.get(
        `${baseURL}/ContentService/data/detail/R-HSA-114269/locationsInPWB`,
        { timeout: 30_000 }
      );
      locationsEndpoint = res.ok();
    } catch {
      locationsEndpoint = false;
    }
  });
  // Not every entry is in a diagram. R-RNO-164160's only reaction belongs to no
  // pathway, so /locationsInPWB answers 404 -- on production too. The page used
  // to render "Locations" as a bare heading with nothing under it, which reads
  // as a page that failed rather than an entry with nothing to show.
  test('says so when an entry appears in no pathway', async ({ page }) => {
    // Holds on either backend: no endpoint and no data both end up here.
    await page.goto('/content/detail/R-RNO-164160');
    await expect(page.getByText('Lkb-1(Stk11)').first()).toBeVisible({ timeout: LOAD });
    await expect(page.locator('.no-locations')).toBeVisible({ timeout: LOAD });
    // and the reaction it catalyses is still reachable
    const goTo = page.locator('.goTo-container a').first();
    await expect(goTo).toHaveAttribute('href', /\/content\/detail\/R-RNO-/, { timeout: LOAD });
  });

  test('still renders the tree when locations do exist', async ({ page }) => {
    test.skip(!locationsEndpoint, 'locationsInPWB absent on this backend');
    await page.goto('/content/detail/R-HSA-114269');
    await expect(page.locator('.root-entry').first()).toBeVisible({ timeout: LOAD });
    await expect(page.locator('.no-locations')).toHaveCount(0);
  });
});

// A curator reported that the release cards "look and act clickable but aren't":
// they lifted under the pointer, which is what a clickable card does, and then did
// nothing. Forty of the ninety-seven releases have an announcement on this site,
// so those are links now and the rest carry no affordance at all. Both halves are
// asserted, because fixing this by making everything inert would also pass a test
// that only checked the links.
test.describe('Release calendar', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  test('releases with an announcement link to it, and the rest do not pretend', async ({
    page,
  }) => {
    await page.goto('/about/release-calendar');
    await expect(page.locator('.release-card').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);

    const linked = page.locator('a.release-card');
    const plain = page.locator('div.release-card');
    expect(await linked.count(), 'releases with an announcement').toBeGreaterThan(30);
    expect(await plain.count(), 'releases without one').toBeGreaterThan(10);

    // Every link goes to a news article, not somewhere invented.
    for (const card of (await linked.all()).slice(0, 5)) {
      expect(await card.getAttribute('href')).toMatch(/^\/about\/news\/[\w-]+$/);
    }

    // The pointer distinguishes them, and only the link responds to hover.
    const link = linked.first();
    const card = plain.first();
    expect(await link.evaluate((e) => getComputedStyle(e).cursor)).toBe('pointer');
    expect(await card.evaluate((e) => getComputedStyle(e).cursor)).not.toBe('pointer');

    await card.hover();
    expect(
      await card.evaluate((e) => getComputedStyle(e).transform),
      'a card that cannot be clicked must not move under the pointer'
    ).toBe('none');
    await link.hover();
    expect(
      await link.evaluate((e) => getComputedStyle(e).transform),
      'a card that can be clicked should respond'
    ).not.toBe('none');

    // And the link actually opens that release's announcement.
    const href = (await link.getAttribute('href')) ?? '';
    expect(href, 'the link has a destination').not.toBe('');
    await link.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/\//g, '\\/')), { timeout: 60_000 });
    await expect(page.locator('app-page-layout')).toContainText(/Released/i, { timeout: 60_000 });
  });
});

test.describe('Section sidebar', () => {
  // A page inside a section was headed only if the section's own page had been
  // shown first, and reached from another section it kept that section's name.
  test('heads a page with its own section, however it is reached', async ({ page }) => {
    const heading = page.locator('app-sidebar .section-title');
    await page.goto('/about/team');
    await expect(heading).toHaveText('About', { timeout: LOAD });

    await page.goto('/documentation');
    await expect(heading).toHaveText('Docs', { timeout: LOAD });
    // In the app, not a fresh load: the sidebar is the same one.
    await page.locator('app-sidebar .sidebar-item a').first().click();
    await expect(page).not.toHaveURL(/\/documentation$/);
    await expect(heading).toHaveText('Docs');
  });

  // An article's sidebar lists its siblings from the section's index. The list
  // was written into plain fields when the index arrived, after change
  // detection had been asked for, so Angular found the view changed after
  // checking it (NG0100) -- intermittently, whenever the index was slow.
  for (const [section, page, title, heading] of [
    ['about/news', '238-version-87-released', 'V87 released', 'News & Updates'],
    ['content/reactome-research-spotlight', null, null, 'Reactome Research Spotlights'],
  ] as const) {
    test(`lists ${heading} beside an article, however late the list arrives`, async ({
      page: browser,
    }) => {
      await browser.route(`**/content/${section}/index.json`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      let slug: string = page ?? '';
      let label: string = title ?? '';
      if (!page) {
        // Whichever spotlight the index lists first; they change.
        type Entry = { slug: string; title: string };
        const data = (await (
          await browser.request.get(`/content/${section}/index.json`)
        ).json()) as Entry[] | { articles: Entry[] };
        const first = (Array.isArray(data) ? data : data.articles)[0];
        slug = first.slug;
        label = first.title;
      }
      await browser.goto(`/${section}/${slug}`);
      const sidebar = browser.locator('app-sidebar');
      await expect(sidebar.locator('.section-title')).toHaveText(heading, { timeout: LOAD });
      await expect(sidebar.locator('.sidebar-item.active')).toHaveText(label, { timeout: LOAD });
      expect(await sidebar.locator('.sidebar-item').count()).toBeGreaterThan(1);
    });
  }
});
