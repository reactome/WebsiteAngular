/**
 * One search hit, as `/search/query` actually returns it.
 *
 * Solr omits a field rather than sending it empty, so most of this is optional
 * -- and it was all declared required, which is worse than it sounds. A field
 * the type promises is always there can be dereferenced anywhere without
 * complaint, so `strictTemplates` agrees right up until the page renders
 * `undefined`. The templates already knew better and guarded with `?.`, which
 * is why the build emitted seventeen NG8107/NG8102 diagnostics telling us to
 * remove guards that are load-bearing. The type was the thing that was wrong.
 *
 * Measured against the running service, 444 entries over three queries
 * (`TP53`, `insulin`, `membrane`), so it can be re-measured rather than
 * believed:
 *
 *     always present   dbId, stId, id, name, type, exactType
 *     referenceName    absent in 81%
 *     databaseName     absent in 73%   referenceIdentifier  73%
 *     referenceURL     absent in 73%   summation            58%
 *     compartmentNames absent in 21%   isDisease            11%
 *     species          absent in 0.5%  -- rare, not never
 *     deleted, date    absent in 100%  -- they arrive only on deleted entries
 *
 * The service also returns `compartmentAccession`, `hasReferenceEntity`,
 * `disease`, `hasEHLD` and `explanation`, which nothing here reads. They are
 * left undeclared deliberately: adding a field nobody uses invites somebody to
 * use it without checking whether it is always sent.
 */
export interface SearchEntry {
  dbId: number;
  stId: string;
  id: string;
  name: string;
  type: string;
  exactType: string;
  species?: string[];
  summation?: string;
  compartmentNames?: string[];
  isDisease?: boolean;
  referenceName?: string;
  referenceIdentifier?: string;
  databaseName?: string;
  referenceURL?: string;
  deleted?: boolean;
  date?: number;

  // Present only on deleted entries: where the object went, so the result can
  // link on to its replacement.
  replacementStIds?: string[];

  // Icon results carry their own attribution block. The search service only
  // sends these for type Icon, hence optional.
  icon?: string;
  iconName?: string;
  iconCuratorName?: string;
  iconCuratorOrcidId?: string;
  iconDesignerName?: string;
  iconDesignerUrl?: string;
}

export interface ResultGroup {
  typeName: string;
  entries: SearchEntry[];
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
