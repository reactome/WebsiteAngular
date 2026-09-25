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
    // The home page itself has no path left; an empty href would mean the page
    // the reader is already on.
    return reactomeUrlMatch[1].replace(/^\//, '') || '/';
  }

  if (url.startsWith('/')) {
    return url.replace(/^\/+/, '');
  }

  return url;
}
