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

/**
 * The release to substitute, or null when there is none to wait for.
 *
 * A curator build never asks for a version, so it does not wait at all: the
 * page used to spin forever there. Elsewhere the version usually arrives in
 * well under a second, but the lookup retries a fallback on error and has been
 * slow before, so the wait is long and a give-up is logged, never silent. With
 * no release the placeholder is left as written; the page still renders.
 */
export async function releaseWithin(
  version: Promise<string>,
  { ms = 30_000, skip = false }: { ms?: number; skip?: boolean } = {}
): Promise<string | null> {
  if (skip) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  try {
    const release = await Promise.race([version, timedOut]);
    if (release === null)
      console.warn(`No release after ${ms / 1000}s; {release} links left as written`);
    return release;
  } catch (error) {
    console.warn('Release lookup failed; {release} links left as written', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
