/**
 * The content pages own their own addresses.
 *
 * They render some of the same panels as the pathway browser, from the same
 * UrlStateService, and that service has two effects that write pathway browser
 * state into the URL. On a content page those have to stand down, or opening a
 * detail page rewrites its address into a pathway browser one.
 *
 * The guard that does this used to be a substring test over the whole URL, so a
 * query parameter carrying the word "content" or "query" decided it too -- and
 * `sample` is a column name taken verbatim from the reader's own expression file.
 * Both halves are covered here: the content pages still stand down, and the
 * pathway browser still writes its URL when a parameter happens to say "content".
 */
import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 4 * 60 * 1000 });

const contentPages = [
  '/content/detail/R-HSA-1430728',
  '/content/query?q=kinase',
  '/content/schema/Pathway',
];

for (const path of contentPages) {
  test(`${path} keeps its own address`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const landed = new URL(page.url());
    expect(landed.pathname, 'the page rewrote its own address').toContain(path.split('?')[0]);
  });
}

test('the pathway browser still writes its URL when a parameter says "content"', async ({
  page,
}) => {
  // `?sample=GC__content` is what an expression file with a column called
  // "GC content" produces. Under the old guard this URL silenced every write
  // that followed it: no selection, no flag, no tab, nothing to share.
  await page.goto('/PathwayBrowser/R-HSA-109606?sample=GC__content', {
    waitUntil: 'domcontentloaded',
  });
  // The tabs are not there until the diagram is, and the default tab settles a
  // moment after that.
  await page.waitForFunction(
    () => {
      const container = document.querySelector('#cytoscape') as
        (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
      return (container?._cyreg?.cy?.elements().length ?? 0) > 0;
    },
    { timeout: 90_000 }
  );
  await page.waitForTimeout(2500);

  const molecule = page
    .locator('[role="tab"]')
    .filter({ hasText: /Molecule/i })
    .first();
  test.skip((await molecule.count()) === 0, 'this pathway offers no Molecule tab');
  await molecule.click();
  await page.waitForTimeout(2500);

  expect(new URL(page.url()).search, 'choosing a tab reached the URL').toContain('tab=molecule');
});
