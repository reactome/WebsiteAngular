/**
 * `{release}` as authored, and as marked writes it inside a markdown link or
 * image URL, where it percent-encodes the braces.
 */
const PLACEHOLDER = /\{release\}|%7Brelease%7D/gi;

/**
 * Whether this page's body names a release, and so has to wait for one.
 *
 * Checked before awaiting so that the overwhelming majority of pages -- which
 * mention no release at all -- render without waiting on the content service.
 */
export function needsRelease(html: string) {
  return (
    new RegExp(PLACEHOLDER.source, 'i').test(html) || /download\.reactome\.org\/\d+\//.test(html)
  );
}

/**
 * Point release artefacts at the release the database is serving.
 *
 * Authors write `{release}`; this substitutes it. A hardcoded number in a
 * bucket path is rewritten too, because that is how the statistics page came
 * to embed release 95's figures while the site served 97 -- the number was
 * typed into the content once and nothing brings it forward. Everything under
 * the versioned bucket is republished per release, so the current one is
 * always the right answer.
 */
export function applyRelease(html: string, release: string): string {
  return html
    .replace(PLACEHOLDER, release)
    .replace(
      /(download\.reactome\.org\/)\d+(\/)/g,
      (_match, before, after) => `${before}${release}${after}`
    );
}
