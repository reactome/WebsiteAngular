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
  iconCategoriesFacet: IconFacet;
}

export interface IconPhysicalEntity {
  stId: string;
  type: string;
  name: string;
  compartments: string;
  displayName: string;
}

export interface IconEntry {
  stId: string;
  name: string;
  iconName: string;
  // Solr omits an empty field rather than sending `[]`, so a list is only ever
  // a promise about icons that have one. `iconPhysicalEntities` is absent from
  // 3 of 6 single-icon responses; the other two were present in every icon
  // sampled, but that sample is 28 of a corpus of 2,569, which is not evidence
  // of "always". The templates guard all three, and those guards are why the
  // build was reporting them as unnecessary.
  iconCategories?: string[];
  iconReferences?: string[];
  iconEhlds?: string[];
  iconPhysicalEntities?: IconPhysicalEntity[];
  summation: string;
  exactType: string;
  iconCuratorName?: string;
  iconCuratorOrcidId?: string;
  iconDesignerName?: string;
  iconDesignerUrl?: string;
}

export interface IconResult {
  /** Left out when nothing matches. */
  entries?: IconEntry[];
  entriesCount: number;
}
