/**
 * Give a rendered page's images the space they are going to need.
 *
 * A content image arrives without dimensions, so the browser reserves nothing
 * for it and the page grows as each one loads. On
 * `documentation/userguide/reactome-fiviz` that is 116 images taking the
 * document from 27,496px to 78,312px -- and a reader who clicked a
 * table-of-contents link ends up 2,793px above the section they asked for,
 * because the browser scrolled to the right place and the page then grew above
 * them. Six content pages carry twenty or more images.
 *
 * `width` and `height` attributes are what fix it: with `width: 100%` and
 * `height: auto` in the stylesheet, a browser uses the attribute pair as an
 * aspect ratio and holds the right box open before a byte of the image has
 * arrived. They are not a display size.
 *
 * Sizes are measured when content is staged -- see `stage-content.ts` -- and
 * ride along in the page's own JSON, so nothing here has to fetch anything.
 *
 * An image already carrying a width or height is left exactly as it is: the
 * author said something deliberate, and this has no business overruling it.
 */
export default function addImageSizes(
  html: string,
  sizes: Record<string, [number, number]> | undefined
): string {
  if (!sizes || !Object.keys(sizes).length) return html;

  // `[^>]*` would be wrong: an alt text may contain a `>` -- documentation is
  // full of menu paths like "File > Export" -- and matching to the first one
  // truncates the tag mid-attribute, so the width is inserted inside the alt
  // text. Quoted values are matched as units instead.
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    if (/\s(width|height)\s*=/i.test(tag)) return tag;

    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src) return tag;

    const size = lookup(sizes, src);
    if (!size) return tag;

    // Built by hand rather than with a second replace over the whole tag: a
    // `\s+>` cleanup would also match inside an attribute value and eat a
    // space out of somebody's alt text.
    const [width, height] = size;
    const selfClosing = /\/>$/.test(tag);
    const body = tag.replace(/\s*\/?>$/, '');
    return `${body} width="${width}" height="${height}"${selfClosing ? ' />' : '>'}`;
  });
}

/**
 * Find a size for a src that has probably been rewritten since it was measured.
 *
 * Two things move between staging and here, and both were found by looking at
 * the rendered markup rather than by reasoning about the chain:
 *
 *   * `normalizeContentUrl` strips the leading slash, so an image measured as
 *     `/uploads/x.png` reaches this function as `uploads/x.png`. Keying on the
 *     literal string made the whole transform inert -- 114 images on the FIViz
 *     page, 0 of them given a size, while the page still looked better because
 *     the browser had the images cached from a previous run.
 *   * content is authored by hand, so the same path appears encoded on one page
 *     and not on another.
 *
 * So the comparison is on the path with any leading slash removed, tried both
 * as written and decoded. Anything still unmatched is left alone.
 */
function lookup(
  sizes: Record<string, [number, number]>,
  src: string
): [number, number] | undefined {
  const forms = [src, safely(decodeURIComponent, src), safely(encodeURI, src)];
  for (const form of forms) {
    const bare = form.replace(/^\//, '');
    const found = sizes[form] ?? sizes[`/${bare}`] ?? sizes[bare];
    if (found) return found;
  }
  return undefined;
}

function safely(decode: (value: string) => string, value: string): string {
  try {
    return decode(value);
  } catch {
    // `decodeURIComponent('%')` throws, and a malformed src is not a reason to
    // fail the whole page.
    return value;
  }
}
