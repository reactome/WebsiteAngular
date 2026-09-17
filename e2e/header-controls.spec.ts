/**
 * The Species and Overlay controls can be used without a mouse.
 *
 * Both were plain `<div>`s with a click handler — measured on beta 2026-09-16:
 * `{ role: null, tabindex: null, focusable: false }`. So neither could be
 * focused or activated from the keyboard, and neither was announced as anything
 * at all. Issue #211, found while reviewing the rename in #208.
 *
 * Asserted by driving them the way someone without a mouse does — focus, then a
 * key — rather than by checking the attributes are present. The attributes are
 * the mechanism; reaching the panel is the thing.
 */
import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

const PATHWAY = 'R-HSA-1368108';
const BOOT_TIMEOUT = 90_000;

/** Whether the interactors panel is actually on screen. */
const panelOpen = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('cr-interactors') as HTMLElement | null;
    return !!panel && panel.offsetParent !== null && panel.getBoundingClientRect().height > 0;
  });

test.describe('The header controls', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('open from the keyboard, and say what they are', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);

    expect(await panelOpen(page), 'closed to begin with').toBe(false);

    const interactors = page.locator('.species-interactor-container .interactor');
    await interactors.focus();
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains('interactor')),
      'the control takes focus'
    ).toBe(true);

    await page.keyboard.press('Enter');
    await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(true);

    await page.keyboard.press('Enter');
    await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(false);

    // Space activates too, and must not scroll the page while doing it -- the
    // default action for Space on a focused element.
    await page.keyboard.press(' ');
    await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(true);
    expect(await page.evaluate(() => window.scrollY), 'without scrolling the page').toBe(0);

    // What a screen reader is told.
    const semantics = await page.evaluate(() => {
      const el = document.querySelector('.species-interactor-container .interactor');
      const species = document.querySelector('.species-interactor-container .species');
      return {
        role: el?.getAttribute('role'),
        label: el?.getAttribute('aria-label'),
        expanded: el?.getAttribute('aria-expanded'),
        speciesRole: species?.getAttribute('role'),
        speciesTabindex: species?.getAttribute('tabindex'),
      };
    });
    expect(semantics.role).toBe('button');
    expect(semantics.label).toBeTruthy();
    expect(semantics.expanded, 'and its state').toBe('true');

    // Species is the same pattern and the same problem; a reader tabbing through
    // the header should meet both or neither.
    expect(semantics.speciesRole).toBe('button');
    expect(semantics.speciesTabindex).toBe('0');
  });

  test('close on Escape, and give focus back', async ({ page }) => {
    await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cytoscape canvas', { timeout: BOOT_TIMEOUT });
    await page.waitForTimeout(4000);

    await page.locator('.species-interactor-container .interactor').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(true);

    // Into the panel, which is where a reader will be when they want out of it.
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('cr-interactors')),
      'tab moves into the panel'
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => panelOpen(page), { timeout: 15_000 }).toBe(false);

    // And the reader still has their place. Without this focus falls to <body>,
    // so closing the panel costs them the whole page.
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains('interactor')),
      'focus returns to the control that opened it'
    ).toBe(true);

    // It says what it controls, not just that it is expanded.
    expect(
      await page.evaluate(() =>
        document
          .querySelector('.species-interactor-container .interactor')
          ?.getAttribute('aria-controls')
      )
    ).toBeTruthy();
  });
});
