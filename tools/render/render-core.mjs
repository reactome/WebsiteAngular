/**
 * Rendering one pathway through the site's own render page.
 *
 * Shared by the CLI and the service so there is exactly one implementation of
 * "wait for the page, ask it for the artefact" -- the whole point of this work
 * is not having two renderers, and that argument applies to its callers too.
 */
import { gifFromPage, DEFAULT_DELAY, MAX_SIZE } from './gif.mjs';
import { pptx } from './pptx.mjs';

/** Formats the render page can produce. */
export const FORMATS = ['svg', 'png', 'pdf', 'gif', 'pptx'];

/**
 * Longest side of the raster PowerPoint falls back to when it cannot draw SVG.
 *
 * Its own constant, deliberately not the GIF's: that one is 0 now, meaning "the
 * diagram's own size", and `MAX_SIZE / longest` with a zero would have asked for
 * a PNG at scale 0. The zip would still have cleared the size floor, because the
 * SVG in it is the real picture -- a blank fallback nobody looks at until the one
 * viewer that needs it opens the file.
 */
const FALLBACK_MAX_SIZE = 2000;

/** Anything smaller than this is not a real render; see the Reacfoam notes. */
const MIN_BYTES = { svg: 2000, png: 5000, pdf: 5000, gif: 5000, pptx: 10_000 };

/**
 * The floor for a PowerPoint built out of shapes.
 *
 * The 10KB above is right for a package carrying a picture, because the picture
 * of any real diagram is far larger than that. A slide of shapes is not: the
 * package boilerplate is around 4.9KB compressed and each shape adds tens of
 * bytes, so a reaction framed down to a dozen glyphs came to 7.2KB and was
 * rejected as "too small to be a real render". What makes that package real is
 * that it has shapes in it, which is already established before it is built --
 * this is left only as a guard against a truncated zip.
 */
const MIN_SHAPE_BYTES = 4000;

/**
 * The URL of the render page for a pathway. Omit the pathway for the
 * genome-wide view.
 */
function renderUrl({
  base,
  pathway,
  token,
  subpathways = true,
  dark = false,
  select = '',
  view = '',
}) {
  const url = new URL(
    `${base.replace(/\/$/, '')}/PathwayBrowser/render${pathway ? '/' + pathway : ''}`
  );
  if (token) url.searchParams.set('analysis', token);
  // Set only when turning them off, so the ordinary URL stays the short one.
  if (!subpathways) url.searchParams.set('subpathways', 'false');
  // Likewise: light is the default for a figure, so only dark is spelled out.
  if (dark) url.searchParams.set('dark', 'true');
  // Frames the figure on one event -- what a reaction page wants, rather than
  // the whole diagram the reaction happens to live in.
  if (select) url.searchParams.set('select', select);
  // view=reaction draws the reaction's own layout, which is the figure the
  // reaction page shows -- so its downloads are that picture rather than the
  // pathway diagram the reaction sits in.
  if (view) url.searchParams.set('view', view);
  return url.toString();
}

/**
 * Render one pathway on an existing Playwright page.
 *
 * The caller owns the page so a service can pool them. Returns the bytes plus
 * what the page reported drawing, which is worth logging: "410 elements" is the
 * difference between a diagram and an empty canvas.
 */
export async function render(
  page,
  {
    base,
    pathway = '',
    format = 'svg',
    token = '',
    scale = 2,
    subpathways = true,
    dark = false,
    select = '',
    view = '',
    delay = DEFAULT_DELAY,
    maxSize = MAX_SIZE,
    timeout = 120_000,
  }
) {
  if (!FORMATS.includes(format)) {
    throw new Error(`unknown format "${format}" -- expected ${FORMATS.join(', ')}`);
  }

  const problems = [];
  const onPageError = (e) => problems.push(String(e).slice(0, 200));
  const onConsole = (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  try {
    await page.goto(renderUrl({ base, pathway, token, subpathways, dark, select, view }), {
      waitUntil: 'load',
      timeout,
    });

    // The page's own signal, and its failure signal. A diagram fetches its
    // layout, its overlays and its fonts, and no fixed wait is both correct and
    // quick -- but waiting only for success means an id that does not resolve
    // costs a full timeout rather than the second it takes to find out.
    await page.waitForSelector(
      'cr-render[data-render-ready="true"], cr-render[data-render-error]',
      {
        timeout,
      }
    );

    const state = await page.evaluate(() => window.__renderState);
    if (state?.error) throw new Error(state.error);

    let bytes;
    const detail = {};
    if (format === 'svg') {
      bytes = Buffer.from(
        await page.evaluate(async () => await window.__renderExport.svg()),
        'utf8'
      );
    } else if (format === 'png') {
      bytes = await pngBytes(page, scale);
    } else if (format === 'pdf') {
      bytes = await pdfFromSvg(page, timeout);
    } else if (format === 'gif') {
      // Never above 1x. A GIF stores every frame, so doubling the scale
      // quadruples a file that already has one picture per sample -- and 256
      // colours is the ceiling on quality regardless of size, so the pixels
      // would buy nothing.
      const gif = await gifFromPage(page, { scale: Math.min(scale, 1), delay, maxSize });
      bytes = gif.bytes;
      Object.assign(detail, {
        size: gif.size.join('x'),
        frames: gif.frames,
        distinct: gif.distinct,
        truncated: gif.truncated,
      });
    } else {
      const slide = await pptxFromPage(page, { scale, title: state?.name ?? '' });
      bytes = slide.bytes;
      // "430 shapes" against "one picture" is the whole difference between this
      // export and the one it replaces, so it belongs in the line the run logs.
      Object.assign(detail, slide.detail);
    }

    const floor = detail.shapes ? MIN_SHAPE_BYTES : MIN_BYTES[format];
    if (bytes.length < floor) {
      throw new Error(
        `${format} came out at ${bytes.length} bytes, too small to be a real render ` +
          `(expected at least ${floor})`
      );
    }

    return { bytes, state: { ...(state ?? {}), ...detail }, problems };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

/** The diagram as PNG bytes, decoded from the data URL the page hands back. */
async function pngBytes(page, scale) {
  const dataUrl = await page.evaluate(async (s) => await window.__renderExport.png(s), scale);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/**
 * The size the SVG declares, which is the diagram's own size rather than the
 * viewport's. Everything that puts a diagram in a document needs it.
 */
function svgSize(svg) {
  return {
    width: Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 1600),
    height: Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 1000),
  };
}

/**
 * PowerPoint of the rendered diagram: the SVG for PowerPoint to draw and to
 * convert to shapes, and a PNG for everything that cannot.
 */
async function pptxFromPage(page, { scale, title }) {
  // Shapes first: a slide of shapes needs no picture, and the diagram is around
  // 6000px wide, so rendering one to throw it away is the expensive half of the
  // export.
  const shapes = await page.evaluate(async () => (await window.__renderExport.shapes?.()) ?? null);
  if (shapes?.shapes?.length) {
    return {
      bytes: pptx({ title, shapes, width: shapes.width, height: shapes.height }),
      detail: { shapes: shapes.shapes.length },
    };
  }

  const svg = await page.evaluate(async () => await window.__renderExport.svg());
  const size = svgSize(svg);

  // The PNG is only what a viewer that cannot draw SVG falls back to, and a
  // diagram's own coordinate space is around 6000px wide -- at the requested
  // scale the fallback came out at 6MB, dwarfing the vector version PowerPoint
  // actually uses. Cap it at the same size the animation uses.
  const longest = Math.max(size.width, size.height);
  // The genome-wide view draws to a canvas and declines to export a PNG at all.
  // It has an SVG, so it gets a slide; losing the fallback raster costs viewers
  // older than PowerPoint 2016, and is better than losing the export.
  let png = null;
  try {
    png = await pngBytes(page, Math.min(scale, FALLBACK_MAX_SIZE / longest));
  } catch (error) {
    if (!/cannot export PNG/i.test(String(error))) throw error;
  }
  return {
    bytes: pptx({ svg, png, title, ...size }),
    detail: { picture: png ? 'svg+png' : 'svg' },
  };
}

/**
 * PDF from the exported SVG rather than from the page.
 *
 * The page is a viewport-sized window onto the diagram; the SVG is the whole
 * thing at its own size, which is what belongs in a document.
 */
async function pdfFromSvg(page, timeout) {
  const svg = await page.evaluate(async () => await window.__renderExport.svg());
  const { width, height } = svgSize(svg);

  // The same page, not a second one. The artefact is already extracted, so the
  // render page has done its job, and a page made by browser.newPage() has no
  // context a caller is allowed to open pages in.
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
      `<style>@page{margin:0}html,body{margin:0;padding:0}svg{display:block}</style>${svg}`,
    { waitUntil: 'load', timeout }
  );
  await page.evaluate(() => document.fonts.ready);
  return await page.pdf({
    width: `${Math.ceil(width)}px`,
    height: `${Math.ceil(height)}px`,
    printBackground: true,
    pageRanges: '1',
  });
}
