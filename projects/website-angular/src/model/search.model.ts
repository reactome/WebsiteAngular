/**
 * One search hit, any kind: the contract's view of the entry (spec 016), from
 * the search indexer's documents as the service writes them. A field one
 * kind lacks is optional here; narrow on `type` or `deleted` for one kind.
 */
export type { SearchEntryView as SearchEntry } from '../../../contract/search.ts';
import type { SearchEntryView } from '../../../contract/search.ts';

export interface ResultGroup {
  typeName: string;
  entries: SearchEntryView[];
  entriesCount: number;
  rowCount: number;
}

export interface SearchResult {
  results: ResultGroup[];
  rowCount: number;
  numberOfMatches: number;
}

export type { Facet, FacetResponse, NamedFacetCount } from '../../../contract/search.ts';

export interface SearchFilters {
  species?: string[];
  types?: string[];
  compartments?: string[];
  keywords?: string[];
  // Client-side filter for the merged site-search "Pages" group. Values are
  // page categories (e.g. "News", "Documentation").
  pageCategories?: string[];
}
