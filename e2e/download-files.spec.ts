import { test, expect } from '@playwright/test';

// The download page is a catalogue of files that live somewhere else: the
// versioned CloudFront bucket for release artefacts, reactome.org/download/tools
// for the tools. Nothing in the build can tell you whether those files are
// actually there, and a wrong name is invisible until someone clicks it.
//
// Before this ran, 33 of 74 links were broken: the Guide to Pharmacology set was
// named IUPHAR* where it is published as GtoP*, every PE mapping asked for .tsv
// where the files are .txt, the interaction files were missing their
// interactors/ directory, the figure archives had a directory that does not
// exist, and the whole functional-interaction and curator-tool sections pointed
// at <bucket>/current/, a prefix the bucket has never had. The version was wrong
// on top of that -- read once before the content service answered, so the page
// offered the previous release.

/** Everything the page offers, with each section opened first. */
async function fileLinks(page: import('@playwright/test').Page) {
  await page.goto('/download-data');
  await expect(page.locator('a.download-item').first()).toBeVisible({ timeout: 60_000 });

  // The mapping grids and info panels hide links until opened.
  for (const control of await page.locator('button, summary, .expander, .info-toggle').all()) {
    await control.click({ timeout: 1500 }).catch(() => {});
  }
  await page.waitForTimeout(1500);

  return await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((h) => h.includes('download.reactome.org') || h.includes('reactome.org/download/'))
    ),
  ]);
}

test.describe('Download catalogue', () => {
  test.describe.configure({ timeout: 8 * 60 * 1000 });

  test('the page offers the release the site is serving', async ({ page, request }) => {
    const served = (
      await (await request.get('/ContentService/data/database/version')).text()
    ).trim();
    await page.goto('/download-data');

    // Not merely "a version": the one the content service reports. A one-shot
    // read of that answer is how this page came to advertise the release before.
    await expect(page.locator('.version-badge')).toHaveText(`Current Release: V${served}`, {
      timeout: 60_000,
    });

    const links = await fileLinks(page);
    expect(links.filter((h) => h.includes('download.reactome.org')).length).toBeGreaterThan(50);
    for (const href of links) {
      expect(href, 'no link is built from a prefix the bucket does not have').not.toContain(
        '/current/'
      );
    }
  });

  test('every file it offers is really there', async ({ page, request }) => {
    // The files are external; if the bucket cannot be reached at all, that says
    // nothing about this build.
    const reachable = await request
      .head('https://download.reactome.org/97/ReactomePathways.txt')
      .catch(() => null);
    test.skip(
      !reachable || reachable.status() >= 400,
      'the download bucket is not reachable from here'
    );

    const links = await fileLinks(page);
    const checked = await Promise.all(
      links.map(async (href) => ({
        href,
        status: await request
          .head(href)
          .then((r) => r.status())
          .catch(() => 0),
      }))
    );

    const broken = checked.filter((r) => r.status !== 200);
    expect(
      broken.map((r) => `${r.status} ${r.href}`),
      `${checked.length} files offered`
    ).toEqual([]);
  });

  // Icons are released files too, published at <version>/icons/svg. They used to
  // be fetched from a hardcoded backend host, because they are not proxied on
  // beta or release -- so the site's own icons came cross-origin from
  // dev.reactome.org. This fails if that ever comes back.
  test('the icon library draws its artwork from the release bucket', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('response', (response) => {
      const url = response.url();
      if (/icons?\//.test(url) && url.endsWith('.svg')) hosts.add(new URL(url).host);
    });

    await page.goto('/community/icon-lib');
    await expect(page.locator('img').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(4000);

    expect([...hosts], 'icons come from the download bucket and nowhere else').toEqual([
      'download.reactome.org',
    ]);

    // And they are really drawn, not merely requested.
    const drawn = await page.evaluate(
      () =>
        [...document.querySelectorAll('img')].filter(
          (image) => image.src.includes('/icons/svg/') && image.complete && image.naturalWidth > 0
        ).length
    );
    expect(drawn, 'icons that actually rendered').toBeGreaterThan(5);
  });

  // Figures were the last asset the new site took from somewhere other than the
  // release: they lived in the legacy Joomla document root, and our own origin
  // answers those paths with the application's index.html -- so every figure on
  // the site was a 200 that was not an image. They are published at the bucket
  // root now, outside any version, because a figure is the same file in every
  // release.
  test('an entity page draws its figure from the download bucket', async ({ page }) => {
    const drawn: { host: string; drawn: boolean }[] = [];

    // Biosynthesis of the N-glycan precursor: one plain (non-illustration) figure.
    await page.goto('/content/detail/R-HSA-446193');
    const figure = page.locator('.icon-container.figure img').first();
    await expect(figure).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(3000);

    drawn.push(
      await figure.evaluate((image) => ({
        host: new URL((image as HTMLImageElement).src).host,
        drawn: (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      }))
    );

    // Both halves matter. The host proves it is not falling back to our origin,
    // and naturalWidth proves what came back was an image rather than the
    // application's own HTML with a 200 on it.
    expect(drawn[0].host, 'figures come from the download bucket').toBe('download.reactome.org');
    expect(drawn[0].drawn, 'the figure really rendered').toBe(true);
  });
});
