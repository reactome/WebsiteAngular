// A pathway's citation (spec 016, T024): /citation/pathway/{id}, the two texts
// the pathway browser's cite dialog offers.

/** The two citations, written in the order Java's HashMap writes them. */
export interface PathwayCitation {
  /** How to cite the pathway's diagram. */
  imageCitation: string;
  /** How to cite the pathway. */
  pathwayCitation: string;
}
