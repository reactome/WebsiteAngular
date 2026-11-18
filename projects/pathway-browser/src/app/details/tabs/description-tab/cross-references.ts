/** What a cross-reference is told apart by: the database it points into. */
interface InDatabase {
  readonly databaseName: string;
}

/**
 * Where the details tab lists an object's cross-references and its reference
 * entity's.
 */
export interface CrossReferenceSections<T extends InDatabase> {
  /** The object's own, other than Rhea's: the "Cross references" section. */
  readonly listed: T[];
  /** The object's own Rhea reactions: the "Biochemical reaction" section. */
  readonly rhea: T[];
  /** Its reference entity's (UniProt's, ChEBI's): under "External reference". */
  readonly ofReference: T[];
}

/** The graph names Rhea `RHEA` (release 98); `Rhea` was accepted before too. */
export function isRhea(ref: InDatabase): boolean {
  return ref.databaseName.toUpperCase() === 'RHEA';
}

/**
 * The reference entity's cross-references used to stand in for the object's
 * own whenever it had any, so an entity's own (a variant's Mondo disease and
 * COSMIC mutation) were never shown. And whether a reaction showed its Rhea
 * view was read from its first cross-reference alone: once reactions carried
 * Mondo as well, the order decided it, and every one of them went to Rhea's
 * service, Mondo's identifiers included.
 */
export function crossReferenceSections<T extends InDatabase>(
  own: readonly T[] | undefined,
  ofReference: readonly T[] | undefined
): CrossReferenceSections<T> {
  const mine = own ?? [];
  return {
    listed: mine.filter((ref) => !isRhea(ref)),
    rhea: mine.filter(isRhea),
    ofReference: [...(ofReference ?? [])],
  };
}
