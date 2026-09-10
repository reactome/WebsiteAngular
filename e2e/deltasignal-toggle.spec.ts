/**
 * DeltaSignal is offered only where a deployment asks for it.
 *
 * It is a research feature that depends on a DeltaSignal backend, and `/api` is
 * routed only by proxy.conf.js -- the dev server's proxy, which does not exist in
 * a built artifact. A deployment without that backend must not offer a button
 * whose every call fails, so the profile decides, and absent means off.
 *
 * Both states are checked against one build by setting `window.__APP_ENV` before
 * the app's scripts run, which is the runtime profile override the config already
 * reads. Asserting on the button in the DOM rather than on the flag, because the
 * flag being right is not the thing that matters.
 */
import { test, expect, type Page } from '@playwright/test';

const PATHWAY = 'R-HSA-109606';
const BOOT_TIMEOUT = 90_000;

async function openWithProfile(page: Page, profile?: string) {
  if (profile) {
    await page.addInitScript((name) => {
      (window as Window & { __APP_ENV?: string }).__APP_ENV = name;
    }, profile);
  }
  await page.goto(`/PathwayBrowser/${PATHWAY}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const container = document.querySelector('#cytoscape') as
        (HTMLElement & { _cyreg?: { cy?: { elements(): { length: number } } } }) | null;
      return (container?._cyreg?.cy?.elements().length ?? 0) > 0;
    },
    { timeout: BOOT_TIMEOUT }
  );
  await page.waitForTimeout(1500);
}

// Not an anchored match on the label: the button renders `<mat-icon>` before it,
// and the icon's ligature is text, so its textContent is "conversion_path
// Perturb". An anchored regex found nothing and made this test look like the flag
// was off when it was on.
const perturb = (page: Page) => page.locator('button', { hasText: 'Perturb' });

test.describe('The DeltaSignal toggle', () => {
  test.describe.configure({ timeout: 4 * 60 * 1000 });

  test('offers nothing on a deployment that does not ask for it', async ({ page }) => {
    // The default build is the production profile, which leaves it absent.
    await openWithProfile(page);
    await expect(perturb(page)).toHaveCount(0);
    await expect(page.locator('cr-deltasignal-panel')).toHaveCount(0);
  });

  test('offers it on a deployment that does', async ({ page }) => {
    await openWithProfile(page, 'development');
    await expect(perturb(page)).toHaveCount(1);
  });
});
