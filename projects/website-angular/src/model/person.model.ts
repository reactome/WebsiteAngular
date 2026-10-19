interface Affiliation {
  dbId: number;
  displayName: string;
  address?: string;
  name?: string[];
}

interface Publication {
  dbId: number;
  title?: string;
  displayName?: string;
  author?: number[];
  journal?: string;
  pages?: string;
  pubMedIdentifier?: number;
  url?: string;
  volume?: number;
  year?: number;
}

export interface Person {
  dbId: number;
  displayName: string;
  firstname?: string;
  surname?: string;
  initial?: string;
  orcidId?: string;
  project?: string;
  affiliation?: Affiliation[];
  publications?: Publication[];
}

// Returned by /data/person/{id}/{authored,reviewed}{Pathways,Reactions}.
// Matches Reactome's SimpleEventProjection DTO.
export interface SimpleEvent {
  dbId: number;
  stId: string;
  displayName: string;
  speciesName?: string;
  schemaClass?: string;
}
