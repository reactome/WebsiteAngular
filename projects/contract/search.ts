// The search family's answers, as the content service writes them and the
// site reads them (spec 016).

// A count Solr gives under an empty or null name is written without one, as
// Java's NON_EMPTY writes it: nothing can be shown or chosen by it.
export interface FacetCount {
  name?: string;
  count: number;
}

/** A count that can be shown and chosen. */
export type NamedFacetCount = FacetCount & { name: string };

// Each list is left out when it is empty: `selected` when nothing is chosen,
// `available` when the query matches nothing.
export interface Facet {
  selected?: FacetCount[];
  available?: FacetCount[];
}

// A facet Solr did not count is left out, as Java leaves it out.
export interface FacetResponse {
  totalNumFount: number;
  speciesFacet?: Facet;
  typeFacet?: Facet;
  keywordFacet?: Facet;
  compartmentFacet?: Facet;
}

// As with the search facets, a count under an empty name is written without one.
export interface IconCategory {
  name?: string;
  count: number;
}

// As with the search facets, an empty list is left out.
export interface IconFacet {
  selected?: IconCategory[];
  available?: IconCategory[];
}

export interface IconFacetResponse {
  totalNumFount: number;
  // Left out when Solr did not count it, as the search facets are.
  iconCategoriesFacet?: IconFacet;
}
