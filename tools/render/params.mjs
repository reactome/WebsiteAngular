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
  'layout',
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
    (key) =>
      key in query &&
      // A repeated parameter has no single value to suggest, and joining the
      // array would recommend `token=a%2Cb` -- a different URL that is also
      // wrong.
      !Array.isArray(query[key]) &&
      !(key in BOUNDS && !inBounds(key, query[key]))
  ).map((key) => `${key}=${encodeURIComponent(String(query[key]))}`);
  return `/render/${name}.${format}${kept.length ? `?${kept.join('&')}` : ''}`;
}

export function inBounds(key, value) {
  const number = Number(value);
  const [low, high] = BOUNDS[key];
  return Number.isFinite(number) && number >= low && number <= high;
}

/**
 * Parameters whose values are a closed set, so a value outside it is refused.
 *
 * These were the quiet ones. `subpathways` was `!== 'false'`, so `?subpathways=no`
 * meant *true*; `dark` was `=== 'true'`, so `?dark=yes` meant *false*; and
 * `layout` fell back to the default for anything but the one word. Each is a
 * caller asking for something and being given the opposite, with a 200.
 */
export const ENUMS = {
  layout: ['reaction'],
  subpathways: ['true', 'false'],
  dark: ['true', 'false'],
};

/**
 * `layout=reaction` draws a reaction's own layout, so it needs a reaction.
 *
 * Asked of a pathway the render page never becomes ready, the wait runs its
 * full 45 seconds and the caller gets a Playwright timeout as a 500 — holding
 * one of only two render slots while it does. Read from the graph rather than
 * recalled: `CellDevelopmentStep` and `CellLineagePath` are both easy to miss.
 */
export const REACTION_CLASSES = new Set([
  'BlackBoxEvent',
  'CellDevelopmentStep',
  'Depolymerisation',
  'FailedReaction',
  'Polymerisation',
  'Reaction',
]);

/**
 * `select` and `token` are deliberately not shape-checked.
 *
 * `select` is handed to the diagram's own lookup, which resolves more than
 * stable ids, and a token is opaque to us. Inventing a pattern for either would
 * refuse callers over a rule we made up — the guessing this whole change exists
 * to stop, pointed the other way.
 */
export function badEnums(query) {
  return Object.keys(ENUMS)
    .filter((key) => key in query && !ENUMS[key].includes(String(query[key])))
    .map((key) => `"${key}" must be ${ENUMS[key].map((v) => `"${v}"`).join(' or ')}`);
}

/**
 * Parameters given more than once, which express hands over as an array.
 *
 * Refused rather than resolved to a first or last value, because "which one did
 * it take" is not a question a caller should have to ask. It was also a real
 * hole: `token` was read as `typeof … === 'string' ? … : ''`, so
 * `?token=a&token=b` rendered with **no token at all** — an analysis overlay
 * silently not applied, with a 200. The others were refused already, but only
 * as a side effect of their value checks failing on `"a,b"`; this makes it the
 * rule rather than an accident.
 */
export function repeated(query) {
  return Object.keys(query).filter((key) => Array.isArray(query[key]));
}
