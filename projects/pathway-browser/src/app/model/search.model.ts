import type { IconEntry, PathwayOfEntry, SearchEntryView } from '../../../../contract/search.ts';

export namespace Search {
  export const EMPTY_RESULTS = { found: 0, facets: [], entries: [] } as Search.Result;

  export interface Params extends Record<string, any> {
    query: string;
    species?: string;
    diagram?: string;
    types?: string[];
    includeInteractors?: boolean;
  }

  export type Paginated<T> = T & {
    start: number;
    rows: number;
  };

  // One hit, any kind, and one pathway of `/search/pathways/of`: the
  // contract's (spec 016).
  export type Entry = SearchEntryView;
  export type PathwayOf = PathwayOfEntry;

  export interface Facet {
    name: string;
    count: number;
  }

  // firework and diagram
  export interface Result {
    entries: Entry[];
    facets: Facet[];
    found: number;
  }

  // Add a sub-namespace for Icon-specific results
  export namespace Icon {
    // One icon: the contract's (spec 016).
    export type Entry = IconEntry;

    // A query for icons answers whatever its groups hold: a query matching
    // no icon answers proteins, compounds and the like, any kind.
    export interface EntryResult {
      entries: Search.Entry[];
      typeName: string;
      entriesCount: number;
      rowCount: number;
    }

    export interface Result {
      results: EntryResult[];
      rowCount: number;
      numberOfGroups: number;
      numberOfMatches: number;
    }
  }
}
