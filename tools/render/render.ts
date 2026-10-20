#!/usr/bin/env node
/**
 * Render one pathway from the command line.
 *
 * A thin wrapper over render-core.ts, which is shared with the service so
 * there is one implementation of the render itself.
 *
 *   node tools/render/render.ts --pathway R-HSA-73857 --format svg --out out.svg
 *   node tools/render/render.ts --pathway R-HSA-109606 --format pdf --token "$ANALYSIS_TOKEN"
 *   node tools/render/render.ts --format svg --out genome-wide.svg
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
 *   --species   genome-wide only: whose overview, by taxId (default: the site's)
 *   --layout    reaction, to draw a reaction's own layout rather than a diagram
 *   --highlight comma-separated events to mark on the whole diagram, nothing framed
 *
 * GIF animates one frame per sample of an expression analysis, so it wants a
 * --token; without one it is a single frame. PPTX is drawn as shapes, one per
 * glyph, and says how many it drew.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { FORMATS, render } from './render-core.ts';
import { speciesProblem } from './params.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  return value;
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
  'layout',
  'highlight',
  'species',
];
const unknown = args.filter((arg) => arg.startsWith('--') && !KNOWN.includes(arg.slice(2)));
if (unknown.length) {
  console.error(`unknown flag${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`);
  console.error(`known flags: ${KNOWN.map((name) => '--' + name).join(', ')}`);
  process.exit(2);
}

// Two different figures: one framed on an event, one marking events on the
// whole diagram. The service refuses both together; so does this.
if (flag('select', '') && flag('highlight', '')) {
  console.error('--select and --highlight cannot be used together');
  process.exit(2);
}

const pathway = flag('pathway', '');
{
  // As the service checks it, before a browser is started for nothing.
  const problem = flag('species', '')
    ? speciesProblem(pathway ? pathway : 'genome-wide', { species: flag('species', '') })
    : undefined;
  if (problem) {
    console.error(problem.replaceAll('"species"', '--species'));
    process.exit(2);
  }
}
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
    layout: flag('layout', ''),
    highlight: flag('highlight', ''),
    species: flag('species', ''),
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
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
