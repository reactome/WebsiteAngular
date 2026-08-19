#!/usr/bin/env node
/**
 * Render one pathway to SVG, PNG or PDF from outside the browser.
 *
 * This is the smallest thing that answers the question behind #152: server-side
 * artefacts are produced today by Java libraries that reimplement the drawing,
 * which is why a downloaded PDF looks like the old site. Driving the site's own
 * render page instead means there is one renderer, so an exported figure cannot
 * drift from what a curator sees.
 *
 * Deliberately not a service. No queue, no cache, no HTTP API -- those are only
 * worth designing once we know what a render costs and whether an analysis
 * overlay comes out right, which is what this measures.
 *
 *   node tools/render/render.mjs --pathway R-HSA-73857 --format svg --out out.svg
 *   node tools/render/render.mjs --pathway R-HSA-109606 --format pdf --token <analysis-token>
 *
 *   --pathway   stable id; omit for the genome-wide view
 *   --format    svg | png | pdf        (default svg)
 *   --out       output path            (default <pathway>.<format>)
 *   --token     analysis token, to render with the analysis overlay
 *   --base      site to render against (default http://localhost:4200)
 *   --scale     PNG scale factor       (default 2)
 *   --keep-open leave the browser open on failure, for debugging
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const pathway = flag('pathway', '');
const format = (flag('format', 'svg') || '').toLowerCase();
const token = flag('token', '');
const base = (flag('base', 'http://localhost:4200') || '').replace(/\/$/, '');
const scale = Number(flag('scale', '2'));
const out = flag('out', `${pathway || 'genome-wide'}.${format}`);

if (!['svg', 'png', 'pdf'].includes(format)) {
  console.error(`unknown format "${format}" -- expected svg, png or pdf`);
  process.exit(2);
}

// The render page is inside the Pathway Browser's own routes, so it is served
// wherever the site is; nothing needs deploying separately.
const url = new URL(`${base}/PathwayBrowser/render${pathway ? '/' + pathway : ''}`);
if (token) url.searchParams.set('analysis', token);

const started = Date.now();
const browser = await chromium.launch();
// A fixed viewport so a render is reproducible. It does not decide the output
// size -- full:true exports the graph's own bounding box -- but it does decide
// what the diagram lays itself out into.
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const problems = [];
page.on('pageerror', (e) => problems.push(String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
});

try {
  await page.goto(url.toString(), { waitUntil: 'load', timeout: 120_000 });

  // Wait on the page's own signal. A diagram fetches its layout, its overlays
  // and its fonts; how long that takes is not knowable from out here, and every
  // fixed wait is either a flake or wasted time.
  await page.waitForSelector('cr-render[data-render-ready="true"]', { timeout: 120_000 });

  const state = await page.evaluate(() => window.__renderState);
  if (state?.error) throw new Error(state.error);

  let bytes;
  if (format === 'svg') {
    bytes = Buffer.from(await page.evaluate(async () => await window.__renderExport.svg()), 'utf8');
  } else if (format === 'png') {
    const dataUrl = await page.evaluate((s) => window.__renderExport.png(s), scale);
    bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  } else {
    // PDF from the SVG rather than from the page: the page is a viewport-sized
    // window onto the diagram, while the SVG is the whole thing at its own size.
    const svg = await page.evaluate(async () => await window.__renderExport.svg());
    const width = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 1600);
    const height = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 1000);
    const sheet = await browser.newPage();
    await sheet.setContent(
      `<!doctype html><meta charset="utf-8">` +
        `<style>@page{margin:0}html,body{margin:0;padding:0}svg{display:block}</style>${svg}`,
      { waitUntil: 'load' }
    );
    await sheet.evaluate(() => document.fonts.ready);
    bytes = await sheet.pdf({
      width: `${Math.ceil(width)}px`,
      height: `${Math.ceil(height)}px`,
      printBackground: true,
      pageRanges: '1',
    });
    await sheet.close();
  }

  // A plausibly-sized artefact or nothing. An empty-but-valid SVG is the worst
  // outcome: it writes, it opens, and it shows a blank page -- which is exactly
  // what the genome-wide view currently produces.
  const floor = format === 'svg' ? 2000 : 5000;
  if (bytes.length < floor) {
    throw new Error(
      `${format} came out at ${bytes.length} bytes, which is too small to be a real ` +
        `render (expected at least ${floor}). Refusing to write it.`
    );
  }

  await writeFile(out, bytes);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `${out}  ${bytes.length} bytes  ${seconds}s  ` +
      `[${state?.view ?? 'unknown'}${state?.elements ? `, ${state.elements} elements` : ''}]`
  );
  if (problems.length) {
    console.log(`  ${problems.length} browser problem(s):`);
    for (const p of problems.slice(0, 5)) console.log(`    ${p}`);
  }
} catch (error) {
  console.error(`failed: ${error.message}`);
  if (problems.length) for (const p of problems.slice(0, 5)) console.error(`  ${p}`);
  if (!has('keep-open')) await browser.close();
  process.exit(1);
}

await browser.close();
