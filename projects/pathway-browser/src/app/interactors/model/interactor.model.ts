import cytoscape from 'cytoscape';

import type { Interactor, InteractorEntity } from '../../../../../contract/interactors.ts';

export type { CustomInteraction, PsicquicResource } from '../../../../../contract/interactors.ts';

/** An interactor as the pathway browser draws it: the answer's, with the diagram's nodes it is drawn on. */
export interface DrawnInteractor extends Interactor {
  existingNodes?: cytoscape.NodeCollection;
}

/** An entity's interactors as the pathway browser draws them. */
export interface DrawnInteractorEntity extends Omit<InteractorEntity, 'interactors'> {
  interactors?: DrawnInteractor[] | null;
}

export interface Interactors {
  entities?: DrawnInteractorEntity[];
  resource: string; //STATIC, DisGeNet PSICQUIC resource (e.g. IntAct, MINT, etc) or Custom resource
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
