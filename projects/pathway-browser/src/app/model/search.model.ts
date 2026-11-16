import type {
  DiagramResult,
  FacetCount,
  GroupedResult,
  IconEntry as ContractIconEntry,
  PathwayOfEntry,
  SearchEntryView,
} from '../../../../contract/search.ts';

// Read as a namespace: `import * as Search from '…/search.model'`.

// A type, not an interface, so that it is a record: it is sent as a search's parameters.
export type Params = {
  query: string;
  species?: string;
  diagram?: string;
  types?: string[];
  includeInteractors?: boolean;
};

export type Paginated<T> = T & {
  start: number;
  rows: number;
};

// One hit, any kind, and one pathway of `/search/pathways/of`: the
// contract's (spec 016).
export type Entry = SearchEntryView;
export type PathwayOf = PathwayOfEntry;

// A diagram's or the species overview's search: the contract's (spec 016).
export type Facet = FacetCount;
export type Result = DiagramResult<Entry>;

export const EMPTY_RESULTS: Result = { found: 0, facets: [], entries: [] };

// One icon: the contract's (spec 016).
export type IconEntry = ContractIconEntry;

// A query for icons answers whatever its groups hold: a query matching
// no icon answers proteins, compounds and the like, any kind.
export type IconResult = GroupedResult<Entry>;
