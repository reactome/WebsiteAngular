import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('test-results/reactome-pathway');

test('Reactome legend — render, PNG and SVG export', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const consoleErrors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);

    console.log(`[browser:${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err));

    console.log(`[pageerror] ${err}`);
  });

  await page.setViewportSize({ width: 1800, height: 800 });
  await page.goto('http://127.0.0.1:3334/index.html');

  // Wait for harness to finish rendering and exporting.
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status');
      return (
        s &&
        s.textContent &&
        (s.textContent.startsWith('OK') ||
          s.textContent.startsWith('ERRORS') ||
          s.textContent.startsWith('fatal'))
      );
    },
    { timeout: 60000 }
  );

  const status = await page.textContent('#status');

  console.log('harness status:', status);

  // Capture screenshots and SVG markup.
  await page.locator('#cy-live').screenshot({ path: path.join(OUT_DIR, 'live-canvas.png') });
  await page.locator('#out-png').screenshot({ path: path.join(OUT_DIR, 'png-output.png') });
  await page.locator('#out-svg').screenshot({ path: path.join(OUT_DIR, 'svg-output.png') });
  await page.screenshot({ path: path.join(OUT_DIR, 'all.png'), fullPage: true });

  const svgText = await page.evaluate(() => window.lastSvg);
  if (svgText) {
    fs.writeFileSync(path.join(OUT_DIR, 'legend.svg'), svgText);
  }

  console.log(`Snapshots saved to ${OUT_DIR}`);
  if (consoleErrors.length > 0) {
    console.log(
      `Console errors during capture (${consoleErrors.length}):\n${consoleErrors.slice(0, 10).join('\n')}`
    );
  }
  expect(status, status).toMatch(/^OK/);
  expect(consoleErrors).toEqual([]);
});
