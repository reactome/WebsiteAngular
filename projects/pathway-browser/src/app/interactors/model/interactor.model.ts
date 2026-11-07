import cytoscape from 'cytoscape';

import type { Interactor, InteractorEntity } from '../../../../../contract/interactors.ts';

export type { CustomInteraction, PsicquicResource } from '../../../../../contract/interactors.ts';

/**
 * An interactor as the pathway browser draws it: the answer's, with the diagram's
 * nodes it is drawn on. A custom upload's interactors are built here from pairs of
 * accessions, with no evidence, so the evidence the service always sends is optional.
 */
export interface DrawnInteractor extends Omit<Interactor, 'evidences' | 'evidencesURL'> {
  evidences?: number;
  evidencesURL?: string;
  existingNodes?: cytoscape.NodeCollection;
}

/** An entity's interactors as the pathway browser draws them. */
export interface DrawnInteractorEntity extends Omit<InteractorEntity, 'interactors'> {
  interactors?: DrawnInteractor[] | null;
}

/**
 * Interactors as the pathway browser draws them, from any source: Reactome's own
 * (the contract's `Interactors`), DisGeNET, a PSICQUIC registry, or a custom upload.
 */
export interface DrawnInteractors {
  entities?: DrawnInteractorEntity[];
  /** "static", DisGeNET, a PSICQUIC resource (IntAct, MINT and the like), or a custom one. */
  resource: string;
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
