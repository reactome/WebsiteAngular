import { test, expect } from './support/backend';

// Every link in the site navigation, visited.
//
// This is the check the curators' release document spends its longest paragraph
// on -- "mouse over each of these drop-down menus in turn, ensure that each link
// leads to a valid web page" -- and the one that has actually broken: their QA
// pass found Analyse Gene Expression 404ing and Species Comparison landing on a
// blank panel. Both would have failed here.
//
// The dropdown contents come from CMS content at runtime, not from
// nav-options.json, so the list is read from the rendered navigation rather than
// from config. That way a link added by an editor is covered without anyone
// remembering to add it to a test.
test.describe('Site navigation', () => {
  test('every link in the navigation reaches a real page', async ({ page }) => {
    // 70-odd navigations. Slow, and the alternative is a person doing it.
    // Up to 15s a page if every page stalled, so it still ends with the list of
    // what broke rather than a timeout; a healthy run is a few minutes.
    test.setTimeout(20 * 60 * 1000);

    await page.goto('/');
    await expect(page.locator('app-navigation-bar')).toBeVisible();
    // The menus render their links even while collapsed, so there is no need to
    // open each one -- which also keeps this independent of hover behaviour.
    await page.waitForTimeout(2500);

    const hrefs = await page.evaluate(() => {
      const nav = document.querySelector('app-navigation-bar') ?? document.body;
      return [
        ...new Set(
          [...nav.querySelectorAll('a[href]')]
            .map((anchor) => anchor.getAttribute('href') ?? '')
            .filter((href) => href.startsWith('/') && !href.startsWith('//'))
        ),
      ];
    });

    // A floor rather than an exact count: editors add pages, and a test that
    // fails when the site grows teaches people to ignore it. Far fewer than this
    // means the navigation failed to render, which is worth failing over.
    expect(hrefs.length, 'links found in the navigation').toBeGreaterThan(50);

    // 400 characters is well under the smallest real page (1,299 at the time of
    // writing) and well over an empty shell, which is the "blank panel" the
    // curators reported.
    const ENOUGH = 400;
    const broken: string[] = [];
    for (const href of hrefs) {
      await page.goto(href, { waitUntil: 'domcontentloaded' });
      // Until the page has rendered -- enough text, or the not-found page -- or
      // the ceiling. This slept a fixed 900ms, and the Pathway Browser, the
      // heaviest page here, was sometimes still blank then under load: the test
      // failed on a slow page, not a missing one. A page that never renders
      // reaches the ceiling and is judged below exactly as before.
      await page
        .waitForFunction(
          (enough) =>
            !!document.querySelector('.not-found') ||
            document.body.innerText.replace(/\s+/g, ' ').trim().length >= enough,
          ENOUGH,
          { timeout: 15_000 }
        )
        .catch(() => undefined);

      // The app answers 200 for everything -- it is a single page -- so the
      // status says nothing. What matters is whether a page rendered.
      const notFound = await page.locator('.not-found').count();
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();

      if (notFound) broken.push(`${href} — not-found page`);
      else if (text.length < ENOUGH)
        broken.push(`${href} — only ${text.length} characters rendered`);
    }

    expect(broken, 'navigation links that do not render a page').toEqual([]);
  });
});
