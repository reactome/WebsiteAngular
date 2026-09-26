import { test, expect } from './support/backend';

// The Content Service and Analysis Service pages (curator review, item 1g).
// Opened directly -- which is how Tools and Download opened them, in a new tab
// -- the address reached Tomcat's legacy Swagger page, wrapped in a copy of the
// old reactome.org header whose menu led to pages this site does not have
// ("Analyse gene expression" -> /gsa/home). The address is this site's API page
// now, under the site header; everything beneath it is still the service.

const BOOT = 90_000;

for (const [root, service] of [
  ['/ContentService', 'Content Service'],
  ['/ContentService/', 'Content Service'],
  ['/AnalysisService/', 'Analysis Service'],
] as const) {
  test(`opening ${root} directly shows this site's ${service} page`, async ({ page }) => {
    await page.goto(root);
    // The site's own header, not the legacy copy of reactome.org's.
    await expect(page.locator('app-navigation-bar')).toBeVisible({ timeout: BOOT });
    // The operations themselves, drawn from the service's spec.
    await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: BOOT });
    await expect(page.locator('a[href="/gsa/home"]')).toHaveCount(0);
  });
}

test('the Tools page opens the API pages here, not in a new tab', async ({ page }) => {
  await page.goto('/tools');
  for (const [name, root] of [
    ['Content Service', '/ContentService'],
    ['Analysis Service', '/AnalysisService'],
  ]) {
    const card = page.locator('a.module-card', { hasText: name });
    await expect(card).toBeVisible({ timeout: BOOT });
    await expect(card).not.toHaveAttribute('target', '_blank');
    // Content links are written relative to the site root; what matters is
    // where they lead.
    expect(new URL(await card.evaluate((a: HTMLAnchorElement) => a.href)).pathname).toBe(root);
  }
});

test('the Tools menu opens the Content Service page without leaving the site', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('nav a.dropdown-link[href$="/ContentService"]');
  await expect(link).toHaveCount(1, { timeout: BOOT });
  await expect(link).not.toHaveAttribute('target', '_blank');
  // A marker a full page load would wipe: a router link keeps it.
  await page.evaluate(() => Object.assign(window, { __stayed: true }));
  await link.dispatchEvent('click');
  await expect(page).toHaveURL(/\/ContentService$/);
  await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: BOOT });
  expect(await page.evaluate(() => (window as { __stayed?: boolean }).__stayed)).toBe(true);
});
