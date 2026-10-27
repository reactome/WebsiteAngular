/**
 * One search hit, any kind: the contract's view of the entry (spec 016), from
 * the search indexer's documents as the service writes them. A field one
 * kind lacks is optional here; narrow on `type` or `deleted` for one kind.
 */
export type { SearchEntryView as SearchEntry } from '../../../contract/search.ts';
import type { SearchEntryView } from '../../../contract/search.ts';

// A search's answer, as the contract has it, with the view's entries.
import type { GroupedResult, ResultGroup as Group } from '../../../contract/search.ts';
type ResultGroup = Group<SearchEntryView>;
export type SearchResult = GroupedResult<SearchEntryView>;

/**
 * A group as the search page keeps it: its entries and name settled when the
 * answer arrives, an absent list as none and an absent name as empty text.
 * The answer leaves both out at times (an ungrouped page past the end, a
 * group Solr names with nothing); the page reads them everywhere.
 */
export type ShownGroup = ResultGroup & Required<Pick<ResultGroup, 'entries' | 'typeName'>>;
export type ShownResult = Omit<SearchResult, 'results'> & { results: ShownGroup[] };

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
