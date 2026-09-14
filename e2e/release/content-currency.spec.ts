import { test, expect, type Page } from '@playwright/test';

// Pages that have to say what release the site is serving. These are the rows a
// curator checks by eye every release, and the answer comes from three different
// places: the database (the homepage), an uploaded figure (statistics,
// inferred events) and the news items someone writes.
//
// Both were stale when these were written. The statistics page embedded a
// release number typed into the markdown, which the renderer now substitutes;
// the news announcement for the current release had not been imported, and
// `npm run import:news` brings it over verbatim from the current site.

/** What the site is actually serving, straight from the database. */
async function servedRelease(page: Page) {
  const response = await page.request.get('/ContentService/data/database/version');
  return (await response.text()).trim();
}

test.describe('Release currency', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('the homepage names the release the database serves', async ({ page }) => {
    const release = await servedRelease(page);
    await page.goto('/');

    // Version and date together: the date is the part a reader uses to tell
    // whether they are looking at something current.
    const header = page.locator('.stat-header');
    await expect(header).toContainText(`V${release}`, { timeout: 60_000 });
    await expect(header).toContainText(/Released on\s+\w+ \d+, \d{4}/);
  });

  test('the computationally-inferred-events page shows its figure', async ({ page }) => {
    await page.goto('/documentation/inferred-events');

    const figure = page.locator('img[src*="inferred-events"]');
    await expect(figure).toBeVisible({ timeout: 60_000 });
    // Really drawn, not a broken link with alt text: the figure is republished
    // per release, so a missing file is the failure mode.
    const drawn = await figure.evaluate(
      (image) =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
    );
    expect(drawn, 'the figure loaded').toBe(true);
  });

  test('the news page lists releases and the latest item opens', async ({ page }) => {
    await page.goto('/about/news');

    // Filtered containers rather than getByText: the version and the word
    // "Released" sit in separate elements, so a regex over one element matches
    // nothing.
    const releaseItems = page.locator('a').filter({ hasText: /V\d+/ });
    // The body of a content page arrives by HTTP after navigation settles, so
    // there is nothing to count until the first item is attached.
    await expect(releaseItems.first()).toBeVisible({ timeout: 60_000 });
    expect(await releaseItems.count(), 'release announcements').toBeGreaterThan(2);

    await releaseItems.first().click();
    await expect(page).toHaveURL(/\/about\/news\/.+/, { timeout: 60_000 });
    // The item itself, not an empty shell.
    await expect(page.locator('app-page-layout')).toContainText(/Reactome/, { timeout: 60_000 });
  });

  test('the statistics page names the current release', async ({ page }) => {
    const release = await servedRelease(page);
    await page.goto('/about/statistics');

    // The figures are release artefacts embedded from the bucket, and the
    // content used to name release 95 because the number was typed into the
    // markdown once. It asks for {release} now, so this checks the substitution
    // as much as the content.
    const embeds = page.locator('iframe[src*="download.reactome.org"]');
    // Same again: the markdown body, and so the iframes in it, are rendered
    // after the page's own request comes back.
    await expect(embeds.first()).toBeAttached({ timeout: 60_000 });
    expect(await embeds.count(), 'embedded statistics figures').toBeGreaterThan(0);
    for (const embed of await embeds.all()) {
      expect(await embed.getAttribute('src')).toContain(`/${release}/stats/`);
    }

    // And the document really is that release's, not merely addressed as it.
    // .first(): "release_stats" is a substring of "ordered_release_stats" too.
    const figure = page.frameLocator('iframe[src$="/release_stats.html"]').locator('body');
    await expect(figure).toContainText(new RegExp(`Version ${release}\\b`), { timeout: 60_000 });
  });

  test('the statistics charts fit their frames rather than scrolling', async ({ page }) => {
    await page.goto('/about/statistics');
    const embeds = page.locator('iframe[src*="download.reactome.org"]');
    await expect(embeds.first()).toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(4000);

    // The first chart is responsive -- 611px tall at 1070 wide, 457 at 800 -- and
    // sat in a fixed 500px box, so it scrolled inside its own frame; the second is
    // a fixed 611 in a 595 box. Ask each document how tall it needs to be and
    // compare with what it was given.
    for (const frame of page.frames().slice(1)) {
      const fit = await frame
        .evaluate(() => ({
          needs: document.documentElement.scrollHeight,
          shows: document.documentElement.clientHeight,
        }))
        .catch(() => null);
      if (!fit) continue;
      expect(fit.needs, 'the chart fits the frame it was given').toBeLessThanOrEqual(fit.shows);
    }
  });

  test('the latest news item is for the current release', async ({ page }) => {
    const release = await servedRelease(page);
    await page.goto('/about/news');

    // Announcements are imported verbatim from the current site by
    // `npm run import:news`; nothing generates their prose. This asserts the
    // import has been run for the release being served.
    const newest = page
      .locator('a')
      .filter({ hasText: /V\d+ Released/ })
      .first();
    await expect(newest).toBeVisible({ timeout: 60_000 });
    await expect(newest).toContainText(`V${release} Released`);
  });
});
