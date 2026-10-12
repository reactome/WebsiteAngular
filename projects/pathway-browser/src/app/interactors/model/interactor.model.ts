import cytoscape from 'cytoscape';

/*
 * Interactors come from four places: Reactome's own (static), DisGeNET,
 * PSICQUIC registries and custom uploads. Measured from the static set (388
 * interactors of four entities, #344); the others are not served where they can
 * be measured, so a field only the static set always sends stays optional.
 */

export interface InteractorEntity {
  acc: string;
  count: number;
  /** Left out when there are none. */
  interactors?: Interactor[] | null;
}

export interface Interactor {
  acc: string;
  accURL: string;
  /** Left out for some (5 of 388 static). */
  alias?: string;
  evidences: number;
  evidencesURL: string;
  id: number;
  score?: number;
  /** Not sent by the static set at all. */
  type?: string;
  existingNodes?: cytoscape.NodeCollection;
}

export interface Interactors {
  entities?: InteractorEntity[];
  resource: string; //STATIC, DisGeNet PSICQUIC resource (e.g. IntAct, MINT, etc) or Custom resource
}

export interface CustomInteraction {
  dbId: number;
  identifier: string;
  score: number;
  evidenceCount: number;
  evidenceURL: string;
  geneName?: string[];
  databaseName: string;
  entitiesCount: number;
  speciesName: string;
  displayName: string;
  variantIdentifier?: string; //Q99IB8-PRO_0000045603

  // Additional properties
  finalGeneName?: string;
  formattedIdentifier?: string;
}

export interface PsicquicResource {
  name: string;
  soapURL: string;
  restURL: string;
  active: boolean;
}

export interface InteractorToken {
  summary: Summary;
  /**
   * What the parser wants the reader to know, when it accepted the data anyway.
   *
   * Plural, and it is an array: the service returns
   * `{"warningMessages":["Missing header. Using a default one."]}`, measured
   * against beta's ContentService on 2026-09-15. It was declared here as a
   * singular string, which is why nothing ever displayed it -- and that
   * particular warning matters, because "using a default one" means the reader's
   * first line was taken as data rather than as a header.
   */
  warningMessages?: string[];
}

interface Summary {
  token: string;
  interactors: number;
  interactions: number;
  fileName: string;
  name: string;
}

export class InputCategory {
  url: string | undefined;
  content: string | FormData | undefined;
}

export enum ResourceType {
  STATIC = 'IntAct',
  DISGENET = 'DisGeNet',
  PSICQUIC = 'PSICQUIC',
  CUSTOM = 'custom',
}

export type ResourceAndType = { name: string | null; type: ResourceType | null };
