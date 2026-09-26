import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// The pathway browser's Tour and Layout controls, which reactome.org's top bar
// has and the redesign never had (curator review, item 2a). The behaviour is
// the former browser's: Tour plays its video in a dialog, and Layout shows and
// hides the hierarchy and details panels or expands the centre view.

const PATHWAY = '/PathwayBrowser/R-HSA-109606';
const BOOT = 90_000;

async function openBrowser(page: Page) {
  // The video itself is never loaded: its host is BLOCKED in support/backend.ts.
  await page.goto(PATHWAY);
  await expect(page.locator('#view')).toBeVisible({ timeout: BOOT });
}

const width = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);
const height = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.getBoundingClientRect().height);

async function choose(page: Page, item: string) {
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitemcheckbox', { name: item }).click();
  // The panels slide; measured once they have settled.
  await page.waitForTimeout(700);
}

test.describe('Tour and Layout', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  test("Tour plays reactome.org's tour video, and closes", async ({ page }) => {
    await openBrowser(page);
    await page.getByRole('button', { name: 'Tour' }).click();

    const dialog = page.getByRole('dialog', { name: 'Pathway Browser Tour' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/rDXvQcBl3Y0'
    );
    // Big enough to watch, and inside the window.
    await expect(dialog.locator('iframe')).toBeInViewport({ ratio: 1 });
    expect(await width(page, 'mat-dialog-container iframe')).toBeGreaterThan(600);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Layout hides and brings back the hierarchy panel', async ({ page }) => {
    await openBrowser(page);
    const before = await width(page, '#view');
    await expect(page.locator('cr-event-hierarchy')).toBeInViewport();

    await choose(page, 'Hierarchy panel');
    // Collapsed to nothing; a 0x0 box still counts as "in viewport" to Playwright.
    expect(await width(page, 'cr-event-hierarchy')).toBe(0);
    expect(await width(page, '#view'), 'the diagram takes the room').toBeGreaterThan(before + 150);
    await page.getByRole('button', { name: 'Layout' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Hierarchy panel' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await page.keyboard.press('Escape');

    await choose(page, 'Hierarchy panel');
    expect(Math.abs((await width(page, '#view')) - before)).toBeLessThan(5);
    expect(await width(page, 'cr-event-hierarchy')).toBeGreaterThan(150);
  });

  test('a hidden hierarchy cannot be reached from the keyboard', async ({ page }) => {
    await openBrowser(page);
    await choose(page, 'Hierarchy panel');
    // Neither the panel's controls nor the divider beside it: focus that lands
    // somewhere invisible leaves a keyboard user lost, and a screen reader would
    // still read the whole hierarchy out.
    const focusable = await page.evaluate(() =>
      [
        '.left-panel input',
        '.left-panel [tabindex="0"]',
        '#container > as-split > .as-split-gutter',
      ]
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .filter((el): el is HTMLElement => !!el)
        .map((el) => {
          el.focus();
          return document.activeElement === el;
        })
    );
    expect(focusable.length, 'the controls are still there to try').toBe(3);
    expect(focusable).toEqual([false, false, false]);

    await choose(page, 'Hierarchy panel');
    await page.locator('.left-panel input').first().focus();
    await expect(page.locator('.left-panel input').first()).toBeFocused();
  });

  test('the hierarchy comes back at the width the reader dragged it to', async ({ page }) => {
    await openBrowser(page);
    const gutter = page.locator('#container > as-split > .as-split-gutter');
    const box = await gutter.boundingBox();
    if (!box) throw new Error('the divider beside the hierarchy is not on screen');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const dragged = await width(page, 'cr-event-hierarchy');

    await choose(page, 'Hierarchy panel');
    await choose(page, 'Hierarchy panel');
    expect(Math.abs((await width(page, 'cr-event-hierarchy')) - dragged)).toBeLessThan(5);
  });

  test('Layout hides and brings back the details panel', async ({ page }) => {
    await openBrowser(page);
    const before = await height(page, '#view');
    await expect(page.locator('cr-details-panel')).toBeInViewport();

    await choose(page, 'Details panel');
    await expect(page.locator('cr-details-panel')).toHaveCount(0);
    expect(await height(page, '#view'), 'the diagram takes the room').toBeGreaterThan(before + 80);

    await choose(page, 'Details panel');
    await expect(page.locator('cr-details-panel')).toBeInViewport();
    expect(Math.abs((await height(page, '#view')) - before)).toBeLessThan(5);
  });

  test('Expanding the centre hides both panels, and restores both', async ({ page }) => {
    await openBrowser(page);
    const hierarchy = await width(page, 'cr-event-hierarchy');
    const details = await height(page, 'cr-details-panel');

    await choose(page, 'Expand the centre view');
    // Collapsed to nothing; a 0x0 box still counts as "in viewport" to Playwright.
    expect(await width(page, 'cr-event-hierarchy')).toBe(0);
    await expect(page.locator('cr-details-panel')).toHaveCount(0);

    await choose(page, 'Expand the centre view');
    expect(Math.abs((await width(page, 'cr-event-hierarchy')) - hierarchy)).toBeLessThan(5);
    expect(Math.abs((await height(page, 'cr-details-panel')) - details)).toBeLessThan(5);
  });
});
