export type { SimpleEvent } from '../../../contract/person.ts';

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
