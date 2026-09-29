import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';
import { HOST_PAGE_PORT } from './support/embed-ports';

/**
 * <reactome-diagram> in a React app (spec 009): pathway from React state,
 * events through a ref, in StrictMode, which mounts, unmounts and remounts on
 * purpose -- the pattern the partner guide gives, and the one that works in
 * both React 18 and 19. React is the repo's own copy (React 18), served to the
 * page by the test rather than fetched from a CDN.
 */

const PAGE = `http://localhost:${HOST_PAGE_PORT}/react.html`;
const LOAD = 90_000;
const vendor = (name: string) =>
  readFileSync(path.join(process.cwd(), 'node_modules', name, 'umd', `${name}.production.min.js`));

async function open(page: Page) {
  await page.route('**/vendor/react.js', (route) =>
    route.fulfill({ body: vendor('react'), contentType: 'text/javascript' })
  );
  await page.route('**/vendor/react-dom.js', (route) =>
    route.fulfill({ body: vendor('react-dom'), contentType: 'text/javascript' })
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE);
  return errors;
}

const loaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loaded: string[] }).__loaded);

const views = (page: Page) =>
  page.evaluate(
    () =>
      document.getElementById('diagram')?.shadowRoot?.querySelectorAll('reactome-diagram-view')
        .length ?? 0
  );

test.describe('the embeddable diagram in a React app', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('draws, in StrictMode, the pathway React gives it', async ({ page }) => {
    const errors = await open(page);
    await expect.poll(() => loaded(page), { timeout: LOAD }).toContain('R-HSA-69620');
    // StrictMode's extra mount and unmount leave one diagram, not two.
    expect(await views(page)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('redraws when React changes the pathway', async ({ page }) => {
    const errors = await open(page);
    await expect.poll(() => loaded(page), { timeout: LOAD }).toContain('R-HSA-69620');
    await page.locator('#switch').click();
    await expect
      .poll(async () => (await loaded(page)).at(-1), { timeout: LOAD })
      .toBe('R-HSA-1257604');
    expect(errors).toEqual([]);
  });

  test('draws again after React unmounts and remounts it', async ({ page }) => {
    const errors = await open(page);
    await expect.poll(() => loaded(page), { timeout: LOAD }).toContain('R-HSA-69620');
    const before = (await loaded(page)).length;
    await page.locator('#toggle').click();
    await expect(page.locator('#diagram')).toHaveCount(0);
    await page.locator('#toggle').click();
    await expect
      .poll(async () => (await loaded(page)).length, { timeout: LOAD })
      .toBeGreaterThan(before);
    expect(await views(page)).toBe(1);
    expect(errors).toEqual([]);
  });
});
