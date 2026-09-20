/**
 * What the render endpoint accepts, kept apart from the server so it can be
 * read and tested without starting one.
 */
/**
 * Everything this endpoint understands, in the order a canonical URL states them.
 *
 * A parameter outside this list is **refused, not ignored**, and that is a
 * deliberate reversal of the usual web convention. Two reasons, and the second
 * is the one that matters.
 *
 * Ignoring one is a silent wrong answer. `?quality=10` served at the default
 * size, or `?flg=TP53` served unflagged, comes back 200 and the caller cannot
 * tell. That is exactly the shape of every bug worth having found this month,
 * and it is the failure mode to expect when these paths take over what the Java
 * exporter serves -- which have eleven parameters of their own.
 *
 * And it is what lets these responses ever be cached. `.png`, `.svg` and `.gif`
 * are cached by extension on our zone already: only `Cache-Control: private,
 * no-cache` below keeps render output out of Cloudflare, so the moment that
 * header is relaxed to cache the good URLs, `?x=<random>` becomes cacheable too
 * -- unbounded entries for one picture, with no rule involved and nothing to
 * connect the bloat to the change. Refusing unknown parameters bounds what can
 * ever be stored, and bounding it is the precondition for caching at all rather
 * than a tidiness argument.
 *
 * `genome-wide` and the id itself are in the path, not here.
 */
export const ACCEPTED = [
  'view',
  'select',
  'scale',
  'subpathways',
  'dark',
  'delay',
  'maxSize',
  'token',
];

/** Bounds for the parameters that take a number, so a value can be refused too. */
export const BOUNDS = {
  scale: [0.25, 2],
  delay: [50, 10_000],
  maxSize: [0, 8000],
};

/**
 * The URL this request should have used, for the error body to quote.
 *
 * Only the parameters that were understood, in ACCEPTED's order, so following
 * it lands on one cache entry rather than on a permutation of one.
 */
export function canonicalUrl(name, format, query) {
  const kept = ACCEPTED.filter(
    (key) => key in query && !(key in BOUNDS && !inBounds(key, query[key]))
  ).map((key) => `${key}=${encodeURIComponent(String(query[key]))}`);
  return `/render/${name}.${format}${kept.length ? `?${kept.join('&')}` : ''}`;
}

export function inBounds(key, value) {
  const number = Number(value);
  const [low, high] = BOUNDS[key];
  return Number.isFinite(number) && number >= low && number <= high;
}
