import type { ObjectState } from './graph/object-state.model';

import type { Participant, ParticipantReference } from '../../../../contract/participants.ts';

export type { Participant } from '../../../../contract/participants.ts';

/** What the molecules tab works out for a participant's reference entity, never sent. */
interface MoleculeView {
  /** "CCNA1" from "UniProt:P78396 CCNA1". */
  formattedName: string;
  type: string;
  /** The right DNA or RNA icon. */
  displayIcon: string;
}

/** A participant's reference entity as the molecules tab shows it. */
export type Molecule = ParticipantReference & MoleculeView;

/** A molecule as the object tree holds it in the molecules view, with the tree's state on it. */
export type TreeMolecule = Molecule & ObjectState;

/** A participant as the molecules tab shows it: its reference entities as molecules. */
export interface ShownParticipant extends Omit<Participant, 'refEntities'> {
  refEntities: Molecule[];
}
