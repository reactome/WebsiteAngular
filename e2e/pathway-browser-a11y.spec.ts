import { test, expect } from './support/backend';

// The Pathway Browser's accessibility (axe, WCAG 2 AA, 24 Nov 2026): the event
// tree's items each in a tree or a group of one, not a list; and names for the
// controls that had only an icon (and a tooltip, which is not a name).
const LOAD = 120_000;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Apoptosis has an illustration, whose zoom slider is one of them.
  await page.goto('/PathwayBrowser/R-HSA-109581');
  await expect(page.locator('cr-event-hierarchy mat-nested-tree-node').first()).toBeVisible({
    timeout: LOAD,
  });
});

test('every item of the event tree sits in the tree or in a group, and no list holds a group', async ({
  page,
}) => {
  // Once a branch is open (the page's own pathway, under its ancestors): a closed
  // tree has no groups to misplace.
  await expect(
    page.locator('cr-event-hierarchy [role="group"] [role="treeitem"]').first()
  ).toBeVisible({
    timeout: LOAD,
  });
  const misplaced = await page.evaluate(() => {
    const items = [...document.querySelectorAll('cr-event-hierarchy [role="treeitem"]')];
    const outside = items.filter((item) => {
      const parent = item.parentElement?.closest('[role]');
      const role = parent?.getAttribute('role');
      return role !== 'tree' && role !== 'group';
    });
    const listed = document.querySelectorAll('cr-event-hierarchy ul > [role="group"]').length;
    return { items: items.length, outside: outside.length, listed };
  });
  expect(misplaced.items).toBeGreaterThan(1);
  expect(misplaced.outside, 'tree items outside the tree or a group').toBe(0);
  expect(misplaced.listed, 'groups held by a list').toBe(0);
});

test('the icon-only controls have names', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Pathways overview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeAttached();
  await expect(page.getByRole('slider', { name: 'Zoom' })).toBeAttached({ timeout: LOAD });
});
