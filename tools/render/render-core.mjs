/**
 * Rendering one pathway through the site's own render page.
 *
 * Shared by the CLI and the service so there is exactly one implementation of
 * "wait for the page, ask it for the artefact" -- the whole point of this work
 * is not having two renderers, and that argument applies to its callers too.
 */

/** Formats the render page can produce. */
export const FORMATS = ['svg', 'png', 'pdf'];

/** Anything smaller than this is not a real render; see the Reacfoam notes. */
const MIN_BYTES = { svg: 2000, png: 5000, pdf: 5000 };

/**
 * The URL of the render page for a pathway. Omit the pathway for the
 * genome-wide view.
 */
export function renderUrl({ base, pathway, token, subpathways = true }) {
  const url = new URL(
    `${base.replace(/\/$/, '')}/PathwayBrowser/render${pathway ? '/' + pathway : ''}`
  );
  if (token) url.searchParams.set('analysis', token);
  // Set only when turning them off, so the ordinary URL stays the short one.
  if (!subpathways) url.searchParams.set('subpathways', 'false');
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
    await page.goto(renderUrl({ base, pathway, token, subpathways }), {
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
    if (format === 'svg') {
      bytes = Buffer.from(
        await page.evaluate(async () => await window.__renderExport.svg()),
        'utf8'
      );
    } else if (format === 'png') {
      const dataUrl = await page.evaluate((s) => window.__renderExport.png(s), scale);
      bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    } else {
      bytes = await pdfFromSvg(page, timeout);
    }

    const floor = MIN_BYTES[format];
    if (bytes.length < floor) {
      throw new Error(
        `${format} came out at ${bytes.length} bytes, too small to be a real render ` +
          `(expected at least ${floor})`
      );
    }

    return { bytes, state: state ?? {}, problems };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

/**
 * PDF from the exported SVG rather than from the page.
 *
 * The page is a viewport-sized window onto the diagram; the SVG is the whole
 * thing at its own size, which is what belongs in a document.
 */
async function pdfFromSvg(page, timeout) {
  const svg = await page.evaluate(async () => await window.__renderExport.svg());
  const width = Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 1600);
  const height = Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 1000);

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
