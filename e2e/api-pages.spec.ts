import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  ['/AnalysisService', 'Analysis Service'],
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

test('the Download page opens the Content Service page without leaving the site', async ({
  page,
}) => {
  await page.goto('/download-data');
  const card = page.locator('a.service-card', { hasText: 'Content Service' });
  await expect(card).toBeVisible({ timeout: BOOT });
  await expect(card).not.toHaveAttribute('target', '_blank');
  await page.evaluate(() => Object.assign(window, { __stayed: true }));
  await card.click();
  await expect(page).toHaveURL(/\/ContentService$/);
  await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: BOOT });
  expect(await page.evaluate(() => (window as { __stayed?: boolean }).__stayed)).toBe(true);
});

/**
 * Every link in the site's content to one operation or group on these pages.
 *
 * They were written for the old springfox page (`#!/exporter/toSBMLUsingGET`),
 * whose names the current spec does not have, and the page did not follow a
 * link at all -- so each opened at the top, leaving the reader to hunt.
 */
function deepLinks(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.mdx')) {
        for (const [, link] of readFileSync(path, 'utf8').matchAll(
          /\((?:<)?(\/(?:Content|Analysis)Service\/#[^)>\s]+)/g
        )) {
          found.add(link);
        }
      }
    }
  };
  walk(join(__dirname, '..', 'projects', 'website-angular', 'content'));
  return [...found].sort();
}

const links = deepLinks();

test('the content has links into the API pages to check', () => {
  expect(links.length).toBeGreaterThan(3);
});

for (const link of links) {
  test(`${link} opens what it points at`, async ({ page }) => {
    const [, tag, operation] = link.split('#')[1].split('/');
    await page.goto(link);
    await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: BOOT });
    if (operation) {
      await expect(page.locator(`#operations-${tag}-${operation}`)).toHaveClass(/is-open/);
    } else {
      await expect(page.locator(`#operations-tag-${tag}`)).toBeVisible();
      await expect(page.locator(`.opblock-tag-section:has(#operations-tag-${tag})`)).toHaveClass(
        /is-open/
      );
    }
  });
}
