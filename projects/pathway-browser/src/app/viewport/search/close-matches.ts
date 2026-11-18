import type * as Search from '../../model/search.model';

/**
 * Below this many characters a query is a gene symbol or a word ("EGFR",
 * "TP53"), whose entities the list groups under their reference entity on
 * purpose, so no second request is made for it.
 */
const CLOSE_MATCH_MIN_LENGTH = 5;

/**
 * How many entities the second request asks for. An entity named as typed
 * ranks first, and the same name recurs only once per compartment (two for
 * "p-6Y-EGFR", release 98).
 */
export const CLOSE_MATCH_ROWS = 10;

/** A name as compared: Solr's highlighting removed, whitespace collapsed, case ignored. */
function comparableName(text: string): string {
  return text
    .replace(/<span class="highlighting" >|<\/span>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Whether a query is specific enough to look for an entity named as typed. */
export function asksForCloseMatches(query: string): boolean {
  return comparableName(query).length >= CLOSE_MATCH_MIN_LENGTH;
}

/**
 * The entities among `entries` named as `query` is, that the pathway
 * browser's grouped list leaves out.
 *
 * That list asks for its scope REFERENCE_ENTITY, which keeps out every entity
 * with a reference entity: a variant such as "p-6Y-EGFR A289T" was found only
 * as "EGFR (P00533)", however exactly it was typed. Only those entities are
 * taken here, so none of them can be in the list already. One whose name is
 * its reference entity's ("EGFR" itself) is what the group's own row stands
 * for, and is left out too.
 */
export function closeNameMatches(query: string, entries: readonly Search.Entry[]): Search.Entry[] {
  const wanted = comparableName(query);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (entry.hasReferenceEntity !== true || entry.name === undefined) return false;
    const name = comparableName(entry.name);
    if (name !== wanted) return false;
    if (entry.referenceName !== undefined && comparableName(entry.referenceName) === name)
      return false;
    if (seen.has(entry.dbId)) return false;
    seen.add(entry.dbId);
    return true;
  });
}
