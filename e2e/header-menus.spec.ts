import { type Locator, type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// The header's menus, redone after the review of 24 Nov 2026: submenus opened
// to the left over the page with a "<" that pushed some labels in, a third level
// ran off the screen, and on a phone the menu was a narrow column with sections
// flying out over the page.
const LOAD = 90_000;

const topItem = (page: Page, name: string) =>
  page.locator('.nav-list > .nav-item').filter({ hasText: name }).first();

/** An element's box, which a visible element has. */
async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('no box: the element is not laid out');
  return found;
}

/** Opens a top menu and waits for it to settle (it slides in), as a reader's pointer would. */
async function openMenu(page: Page, name: string) {
  const item = topItem(page, name);
  await expect(item).toBeVisible({ timeout: LOAD });
  await item.hover();
  await expect(item.locator(':scope > .dropdown-menu')).toHaveClass(/show/);
  await page.waitForTimeout(300);
  return item;
}

test.describe('On a desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('a submenu opens to the right of its row, and every label in a menu lines up', async ({
    page,
  }) => {
    await page.goto('/about');
    const docs = await openMenu(page, 'Docs');
    const links = docs.locator(
      ':scope > .dropdown-menu > .dropdown-list > .dropdown-item > .dropdown-link-wrapper > .dropdown-link'
    );
    await expect(links.first()).toBeVisible();
    const lefts = await links.evaluateAll((all) =>
      all.map((a) => Math.round(a.getBoundingClientRect().left))
    );
    expect(new Set(lefts).size, `label starts ${lefts.join(', ')}`).toBe(1);

    const userguide = docs.locator('.dropdown-item.has-submenu').first();
    await userguide.hover();
    const submenu = userguide.locator(':scope > .nested-dropdown-menu');
    await expect(submenu).toBeVisible();
    // Polled: a submenu slides 4px into place, and a slow machine caught it short.
    const row = await box(userguide);
    await expect
      .poll(async () => (await box(submenu)).x)
      .toBeGreaterThanOrEqual(row.x + row.width - 2);
    const sub = await box(submenu);
    expect(sub.x + sub.width).toBeLessThanOrEqual(1440);
  });

  test('a third level shows in place, inside the second menu', async ({ page }) => {
    await page.goto('/about');
    const docs = await openMenu(page, 'Docs');
    const userguide = docs.locator('.dropdown-item.has-submenu').first();
    await userguide.hover();
    const second = userguide.locator(':scope > .nested-dropdown-menu');
    const third = second.locator('.nested-dropdown-menu a', {
      hasText: 'Analysis Gene Expression',
    });
    await expect(third).toBeVisible();
    const [outer, inner] = await Promise.all([box(second), box(third)]);
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  });

  // A closed menu is hidden, and hidden things take no pointer. The third level
  // was `visibility: visible`, which a child keeps under a hidden parent: under
  // Docs, a patch of the page beside its closed menu, drawn transparent, still
  // caught the pointer and opened Docs from across the page.
  test('a closed menu catches no pointer, so nothing beside it opens it', async ({ page }) => {
    await page.goto('/about');
    await expect(topItem(page, 'Docs')).toBeVisible({ timeout: LOAD });
    await page.mouse.move(5, 880);
    await expect(page.locator('.dropdown-menu.show')).toHaveCount(0);
    const catching = await page.evaluate(() =>
      [...document.querySelectorAll('.nav-list .dropdown-menu *')].flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const at = document.elementFromPoint(x, y);
        return at && el.contains(at) ? [{ x, y }] : [];
      })
    );
    expect(catching, 'points of a closed menu that catch the pointer').toEqual([]);
  });

  test('a submenu near the right edge opens leftwards, on the screen', async ({ page }) => {
    await page.goto('/about');
    const community = await openMenu(page, 'Community');
    const parent = community.locator('.dropdown-item.has-submenu').first();
    await parent.hover();
    const submenu = parent.locator(':scope > .nested-dropdown-menu');
    await expect(submenu).toBeVisible();
    const row = await box(parent);
    await expect
      .poll(async () => {
        const sub = await box(submenu);
        return sub.x + sub.width;
      })
      .toBeLessThanOrEqual(row.x + 2);
    expect((await box(submenu)).x).toBeGreaterThanOrEqual(0);
  });

  test('the page the reader is on is marked in its menu', async ({ page }) => {
    await page.goto('/about/news');
    const about = await openMenu(page, 'About');
    const news = about.locator('a.dropdown-link', { hasText: /^\s*News\s*$/ });
    await expect(news).toHaveAttribute('aria-current', 'page');
    await expect(news).toHaveClass(/current/);
  });
});

test.describe('On a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the menu is a panel across the screen, its sections opening in place', async ({ page }) => {
    await page.goto('/about');
    const button = page.getByRole('button', { name: 'Open the menu' });
    await expect(button).toBeVisible({ timeout: LOAD });
    await button.click();
    await expect(page.getByRole('button', { name: 'Close the menu' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const panel = await box(page.locator('.nav-list'));
    expect(panel.x).toBe(0);
    expect(panel.width).toBe(390);

    const docs = topItem(page, 'Docs');
    await docs.locator('.nav-link').click();
    const userguide = docs.locator('a.dropdown-link', { hasText: /^\s*Userguide\s*$/ });
    await expect(userguide).toBeVisible();
    const [row, link] = await Promise.all([box(docs.locator('.nav-link')), box(userguide)]);
    expect(link.y).toBeGreaterThanOrEqual(row.y + row.height - 1);
    expect(link.x + link.width).toBeLessThanOrEqual(390);
  });

  test('choosing a page closes the menu', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('button', { name: 'Open the menu' }).click({ timeout: LOAD });
    const about = topItem(page, 'About');
    await about.locator('.nav-link').click();
    await about.locator('a.dropdown-link', { hasText: /^\s*Team\s*$/ }).click();
    await expect(page).toHaveURL(/\/about\/team/);
    await expect(page.locator('.nav-list')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open the menu' })).toBeVisible();
  });
});
