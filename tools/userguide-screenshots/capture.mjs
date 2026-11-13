#!/usr/bin/env node
/**
 * Retake the User Guide's screenshots from the live site (#350).
 *
 *   node tools/userguide-screenshots/capture.mjs pathway-browser [name ...]
 *
 * Each page of the guide has a list of shots in shots/<page>.mjs: the address,
 * what to do there, what to crop to, and numbered labels to draw on. They are
 * written into the guide's own image folder,
 * projects/website-angular/public/uploads/documentation/userguide/<page>/,
 * so a release that changes the screens is one command to re-shoot.
 *
 * Taken from beta.reactome.org by default, at a fixed size, in the light
 * theme, with controls that only beta has (the Feedback button, the beta
 * badge) hidden, so the pictures show what a reader of reactome.org sees.
 * On the machine that serves beta, the requests go to it directly rather than
 * out through Cloudflare and back (USERGUIDE_ORIGIN=127.0.0.1, the default
 * here; set it to '' to go through the public address).
 *
 * Nothing here submits an analysis or writes anything: shots only open pages,
 * click, hover and scroll.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const BASE = process.env['USERGUIDE_BASE'] ?? 'https://beta.reactome.org';
const ORIGIN = process.env['USERGUIDE_ORIGIN'] ?? '127.0.0.1';
const VIEWPORT = { width: 1400, height: 860 };

/** Beta-only controls, hidden so the guide shows the public site. */
const HIDE_BETA_ONLY = `
  [mattooltip="Send feedback for the beta version"],
  [mattooltip="Open former Pathway Browser"],
  .version-container .beta, .beta-badge { display: none !important; }
`;

const [pageName, ...only] = process.argv.slice(2);
if (!pageName) {
  console.error('Usage: capture.mjs <guide page> [shot name ...]');
  process.exit(2);
}
const { shots } = await import(join(here, 'shots', `${pageName}.mjs`));
const out = join(root, 'projects/website-angular/public/uploads/documentation/userguide', pageName);
await mkdir(out, { recursive: true });

const host = new URL(BASE).hostname;
const browser = await chromium.launch({
  args: ORIGIN ? [`--host-resolver-rules=MAP ${host} ${ORIGIN}`] : [],
});
let failed = 0;
for (const shot of shots) {
  if (only.length && !only.includes(shot.name)) continue;
  const page = await browser.newPage({
    viewport: shot.viewport ?? VIEWPORT,
    // Crops of small things -- a legend, a glyph -- are taken at 2x so their
    // labels can be read; whole screens stay at 1x to keep the files small.
    deviceScaleFactor: shot.scale ?? 1,
    colorScheme: 'light',
    ignoreHTTPSErrors: Boolean(ORIGIN),
  });
  try {
    await page.goto(BASE + shot.url, { timeout: 120_000 });
    await page.addStyleTag({ content: HIDE_BETA_ONLY });
    if (shot.prepare) await shot.prepare(page);
    if (shot.labels) await label(page, shot.labels);
    const file = join(out, `${shot.name}.png`);
    const clip = shot.clip ? await clipOf(page, shot.clip) : undefined;
    await page.screenshot({ path: file, ...(clip && { clip }) });
    console.log(`  ${shot.name}.png`);
  } catch (error) {
    failed++;
    console.error(
      `  ${shot.name}: ${error instanceof Error ? error.message.split('\n')[0] : error}`
    );
  } finally {
    await page.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);

/** A selector's box, or an explicit {x, y, width, height}, with padding. */
async function clipOf(page, clip) {
  if (typeof clip !== 'string' && !clip.selector) return clip;
  const selector = typeof clip === 'string' ? clip : clip.selector;
  const pad = typeof clip === 'string' ? 8 : (clip.pad ?? 8);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing to crop to: ${selector}`);
  const { width, height } = page.viewportSize() ?? VIEWPORT;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(width - x, box.width + 2 * pad),
    height: Math.min(height - y, box.height + 2 * pad),
  };
}

/** Numbered markers on the page, for the overviews that name its parts. */
async function label(page, labels) {
  const spots = [];
  for (const [n, selector] of labels.entries()) {
    const box = await page
      .locator(selector)
      .first()
      .boundingBox({ timeout: 5_000 })
      .catch(() => null);
    if (!box) throw new Error(`nothing to label: ${selector}`);
    spots.push({ n: n + 1, box });
  }
  await page.evaluate((spots) => {
    for (const { n, box } of spots) {
      const outline = document.createElement('div');
      Object.assign(outline.style, {
        position: 'fixed',
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        outline: '2px solid #e8590c',
        outlineOffset: '1px',
        borderRadius: '4px',
        zIndex: '100000',
        pointerEvents: 'none',
      });
      const badge = document.createElement('div');
      badge.textContent = String(n);
      Object.assign(badge.style, {
        position: 'fixed',
        left: `${Math.max(2, box.x - 10)}px`,
        top: `${Math.max(2, box.y - 10)}px`,
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: '#e8590c',
        color: 'white',
        font: 'bold 13px/22px Roboto, Arial, sans-serif',
        textAlign: 'center',
        zIndex: '100001',
        pointerEvents: 'none',
        boxShadow: '0 1px 3px rgba(0,0,0,.4)',
      });
      document.body.append(outline, badge);
    }
  }, spots);
}
