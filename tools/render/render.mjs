#!/usr/bin/env node
/**
 * Render one pathway from the command line.
 *
 * A thin wrapper over render-core.mjs, which is shared with the service so
 * there is one implementation of the render itself.
 *
 *   node tools/render/render.mjs --pathway R-HSA-73857 --format svg --out out.svg
 *   node tools/render/render.mjs --pathway R-HSA-109606 --format pdf --token "$ANALYSIS_TOKEN"
 *   node tools/render/render.mjs --format svg --out genome-wide.svg
 *
 *   --pathway   stable id; omit for the genome-wide view
 *   --format    svg | png | pdf | gif | pptx   (default svg)
 *   --out       output path            (default <pathway>.<format>)
 *   --token     analysis token, to render with the analysis overlay
 *   --base      site to render against (default http://localhost:4200)
 *   --scale     raster scale factor    (default 2; GIF never exceeds 1)
 *   --delay     GIF milliseconds per frame (default 1000)
 *   --max-size  GIF longest side in pixels  (default 0: the diagram's own size)
 *   --no-subpathways  leave out sub-pathway tints and labels
 *   --dark      render the dark theme (light by default, whatever the host prefers)
 *   --select    frame the figure on one event, e.g. a reaction's stable id
 *   --view      reaction, to draw a reaction's own layout rather than a diagram
 *
 * GIF animates one frame per sample of an expression analysis, so it wants a
 * --token; without one it is a single frame. PPTX is drawn as shapes, one per
 * glyph, and says how many it drew.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { FORMATS, render } from './render-core.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

/**
 * Every flag this understands, checked before anything renders.
 *
 * Without this a misspelled `--pathway` was simply not there: the run went off
 * and rendered the genome-wide view instead, and reported a genome-wide
 * failure. A tool that quietly does something else when asked something it does
 * not understand costs more than the check.
 */
const KNOWN = [
  'pathway',
  'format',
  'out',
  'base',
  'token',
  'scale',
  'delay',
  'max-size',
  'no-subpathways',
  'dark',
  'select',
  'view',
];
const unknown = args.filter((arg) => arg.startsWith('--') && !KNOWN.includes(arg.slice(2)));
if (unknown.length) {
  console.error(`unknown flag${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`);
  console.error(`known flags: ${KNOWN.map((name) => '--' + name).join(', ')}`);
  process.exit(2);
}

const pathway = flag('pathway', '');
const format = (flag('format', 'svg') || '').toLowerCase();
const out = flag('out', `${pathway || 'genome-wide'}.${format}`);

if (!FORMATS.includes(format)) {
  console.error(`unknown format "${format}" -- expected ${FORMATS.join(', ')}`);
  process.exit(2);
}

const started = Date.now();
const browser = await chromium.launch();
// A fixed viewport so a render is reproducible. It does not set the output size
// -- the export uses the graph's own bounding box -- but it is what the diagram
// lays itself out into.
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  const { bytes, state, problems } = await render(page, {
    base: flag('base', 'http://localhost:4200'),
    pathway,
    format,
    token: flag('token', ''),
    scale: Number(flag('scale', '2')),
    delay: Number(flag('delay', '1000')),
    maxSize: Number(flag('max-size', '0')),
    subpathways: !args.includes('--no-subpathways'),
    dark: args.includes('--dark'),
    select: flag('select', ''),
    view: flag('view', ''),
  });

  await writeFile(out, bytes);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const drew = [
    state.view,
    state.elements && `${state.elements} elements`,
    state.groups && `${state.groups} groups`,
    state.shapes && `${state.shapes} shapes`,
    state.picture && `picture: ${state.picture}`,
    state.frames && `${state.frames} frames`,
    state.size,
    state.truncated ? `${state.truncated} samples dropped past the frame limit` : null,
  ]
    .filter(Boolean)
    .join(', ');
  console.log(`${out}  ${bytes.length} bytes  ${seconds}s  [${drew || 'unknown'}]`);
  if (problems.length) {
    console.log(`  ${problems.length} browser problem(s):`);
    for (const p of problems.slice(0, 5)) console.log(`    ${p}`);
  }
} catch (error) {
  console.error(`failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
