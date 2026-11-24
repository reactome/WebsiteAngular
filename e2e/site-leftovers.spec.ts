import { test, expect } from './support/backend';

// Small things left from the UI review of 24 Nov 2026.
const LOAD = 90_000;

test("on a phone, a location's count stays in one piece", async ({ page }) => {
  // "12 locations" broke over two lines in a narrow column beside a squeezed name.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/content/detail/R-HSA-69488');
  const counts = page.locator('.location-count');
  await expect(counts.first()).toBeVisible({ timeout: LOAD });
  const lines = await counts.evaluateAll((all) =>
    all.map((e) =>
      Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))
    )
  );
  expect(Math.max(...lines), `lines per count: ${lines.join(', ')}`).toBe(1);
});

test('an icon library card is not mostly empty space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/community/icon-lib');
  const card = page.locator('.icon-card').first();
  await expect(card).toBeVisible({ timeout: LOAD });
  const box = await card.boundingBox();
  // A square preview made a card taller than it was wide.
  expect((box?.height ?? 1000) / (box?.width ?? 1)).toBeLessThan(1.05);
});
