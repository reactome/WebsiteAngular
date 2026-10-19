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

  export interface Entry {
    dbId: string;
    stId: string;
    databaseName: string;
    exactType: string;
    isDisease: boolean;
    hasEHLD?: boolean;
    name: string;
    referenceIdentifier: string;
    referenceName: string;
    referenceURL: string;
    species: string[];
    compartmentAccession: string[];
    compartmentNames: string[];
  }

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
    export interface Entry {
      stId: string;
      dbId: string;
      id: string;
      name: string;
      type: string;
      exactType: string;
      species: string[];
      summation: string;
      isDisease: boolean;
      hasEHLD?: boolean;
      hasReferenceEntity: boolean;
      disease: boolean;
      deleted: boolean;
      date: number;
    }

    export interface EntryResult {
      entries: Entry[];
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
