/**
 * Point a rendered page's links and images at this site.
 *
 * Content imported from the old site links to itself absolutely --
 * `https://reactome.org/userguide` -- and once this site is reactome.org those
 * links have to land here, on the page that took the old one's place. A path
 * with a leading slash becomes relative to the base href, which is `/`.
 *
 * The docs pages always did this and news articles did not, so a news item's
 * reactome.org links left for production and its `{release}` never resolved.
 * Both now go through the same steps.
 */
/**
 * Paths that are still only on the production site, so a reactome.org link to
 * one keeps going there. Rewritten, it would land on a missing page here --
 * where it used to work. Remove an entry when this site serves the path.
 */
export const STILL_ON_PRODUCTION: readonly RegExp[] = [];

/**
 * Old paths whose page lives somewhere else here, and where a link to one
 * should go instead -- straight there rather than through a redirect.
 */
const MOVED: readonly [RegExp, string][] = [
  // ReactomeGSA's landing page on reactome.org was a separate app; its wizard
  // is built into the Pathway Browser here. The server redirects /gsa too.
  [/^gsa([/?#]|$)/, 'PathwayBrowser?analysisTab=quantitative'],
];

/** Where an old site-relative path (no leading slash) lives now, or itself. */
export function relocate(path: string): string {
  return MOVED.find(([from]) => from.test(path))?.[1] ?? path;
}

export default function rewriteContentUrls(html: string): string {
  return html.replace(
    /\b(href|src)=("([^"]*)"|'([^']*)')/g,
    (_match, attr, _quoted, doubleQuoted, singleQuoted) => {
      const value = doubleQuoted ?? singleQuoted ?? '';
      return `${attr}="${normalizeContentUrl(value)}"`;
    }
  );
}

function normalizeContentUrl(url: string): string {
  const reactomeUrlMatch = url.match(/^https?:\/\/(?:www\.)?reactome\.org\/?(.*)$/i);
  if (reactomeUrlMatch) {
    const rest = reactomeUrlMatch[1].replace(/^\//, '');
    if (STILL_ON_PRODUCTION.some((path) => path.test(rest))) return url;
    // The home page itself has no path left; an empty href would mean the page
    // the reader is already on.
    return relocate(rest) || '/';
  }

  if (url.startsWith('/')) {
    return relocate(url.replace(/^\/+/, ''));
  }

  return url;
}
