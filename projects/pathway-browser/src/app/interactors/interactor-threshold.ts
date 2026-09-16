/**
 * The confidence threshold that decides which interactions are drawn.
 *
 * Interactions carry a `score` between 0 and 1. A curator raises the threshold to
 * clear out the weakly-supported ones, because a well-studied entity brings back
 * more interactors than its diagram has room for: Q13158 returns 33, measured
 * against the ContentService on 2026-09-14, scoring 0.482 to 0.98.
 *
 * Kept here as pure functions rather than inside the service so they can be
 * tested without a browser or a graph, the way `FRAGMENT_PATTERN` and
 * `isContentRoute` are tested in url-state.service.spec.ts.
 */

/**
 * What the old browser opened its slider at.
 *
 * `DEFAULT_SCORE` in reactome/pwp-diagram,
 * `src/main/java/org/reactome/web/diagram/data/InteractorsContent.java`. Matching
 * it is the point: a curator comparing the two sites on the same entity should
 * reach the same conclusion about which interactions are well supported.
 *
 * It is not a value that hides much on its own -- for Q13158 every one of the 33
 * scores is above it -- so it is a floor rather than a filter, and the curator
 * does the filtering.
 */
export const DEFAULT_INTERACTOR_SCORE = 0.45;

/** An interaction, reduced to the one field this decision reads. */
export interface ScoredInteraction {
  score?: number | null;
}

/**
 * A threshold to apply, whatever the URL happened to carry.
 *
 * A fragment of someone's address is not a number: it can be hand-edited, stale,
 * or a word. None of that may stop the pathway opening, so anything unusable
 * becomes the default rather than an error or an empty diagram (FR-008).
 *
 * A value outside 0..1 is not clamped to the nearest end. `2` is not a request
 * for "everything above 1" -- it is a broken address, and treating it as the
 * default is the reading that leaves the reader with something to look at.
 */
export function clampThreshold(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_INTERACTOR_SCORE;
  }

  // `Number`, not `parseFloat`. parseFloat stops at the first character it cannot
  // use and returns what it had, so `0.6.1` reads as 0.6 -- a malformed address
  // silently accepted as a threshold nobody set. The spec caught that; it is the
  // reason this is not a one-liner.
  //
  // Number() has its own trap in the other direction: it reads '' and null as 0,
  // which is a perfectly valid threshold meaning "show everything". So an empty
  // value is rejected before it can be parsed at all.
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return DEFAULT_INTERACTOR_SCORE;

  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_INTERACTOR_SCORE;
  return value;
}

/**
 * Whether this interaction is one the reader asked to see.
 *
 * At or above, so a threshold set to a score exactly keeps that interaction: the
 * reader dragging to 0.6 means "0.6 is good enough", not "better than 0.6".
 *
 * An interaction with no score at all is **hidden**. None were seen in the
 * measured data, but a claim carrying no confidence is precisely what someone
 * raising the threshold is trying to be rid of, so the absent case follows the
 * weak case rather than being waved through.
 */
export function passesThreshold(interaction: ScoredInteraction, threshold: number): boolean {
  const score = interaction.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  return score >= threshold;
}
