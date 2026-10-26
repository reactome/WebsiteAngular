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

// As /data/person/{id}/{authored,reviewed}{Pathways,Reactions} writes it,
// measured over the recorded answers (8 distinct requests, 14 events): the
// edit's date and author and the event's labels are in every one; one had a
// DOI.
export interface SimpleEvent {
  dbId: number;
  stId: string;
  displayName: string;
  speciesName?: string;
  schemaClass?: string;
  dateTime: string;
  authorDbId: number;
  doi?: string;
  labels: string[];
}
