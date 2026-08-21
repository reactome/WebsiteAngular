import { test, expect, type Page } from '@playwright/test';

// Pages that have to say what release the site is serving. These are the rows a
// curator checks by eye every release, and the answer comes from three different
// places: the database (the homepage), an uploaded figure (statistics,
// inferred events) and the news items someone writes.
//
// Two of them are stale right now. They are marked `test.fail()` rather than
// deleted or fudged: CI stays green, and the moment the content is published the
// test passes unexpectedly and says so, which is exactly when someone should
// come back here and turn it into an ordinary assertion.

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

  test('the latest news item is for the current release', async ({ page }) => {
    // Known stale: the newest announcement is V96 while the database serves 97.
    // Someone has to write the V97 item; nothing in the build can. Unlike the
    // statistics page, there is no artefact to point at -- the announcement is
    // written content.
    test.fail();

    const release = await servedRelease(page);
    await page.goto('/about/news');
    await expect(page.getByText(/V\d+ Released/).first()).toContainText(`V${release}`, {
      timeout: 60_000,
    });
  });
});
