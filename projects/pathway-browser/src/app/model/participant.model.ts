import type { ObjectState } from './graph/object-state.model';

export interface Molecule {
  dbId: number;
  identifier: string;
  schemaClass: string;
  displayName: string;
  icon: string;
  displayIcon: string;
  url: string;
  formattedName: string;
  type: string;
}

/** A molecule as the object tree holds it in the molecules view, with the tree's state on it. */
export type TreeMolecule = Molecule & ObjectState;

export interface Participant {
  peDbId: number;
  displayName: string;
  schemaClass: string;
  refEntities: Molecule[];
}
