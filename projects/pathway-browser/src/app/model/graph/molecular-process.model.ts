import { DatabaseObject } from './database-object.model';
import { GO_MolecularFunction } from './go-term/go-molecular-function.model';
import { PhysicalEntity } from './physical-entity/physical-entity.model';
import { PsiMod } from './external-ontology/psi-mod.model';
import { EntitySet } from './physical-entity/entity-set.model';
import { Polymer } from './physical-entity/polymer.model';
import { ReferenceGroup } from './reference-entity/reference-group.model';
import { CatalystActivityReference } from './control-reference/catalyst-activity-reference.model';
import { RegulationReference } from './control-reference/regulation-reference.model';
import { ReferenceMolecule } from './reference-entity/reference-molecule.model';
import { ReactionLikeEvent } from './event/reaction-like-event.model';

/**
 * This Generic type is for rendering data in Molecular Process component and used by catalystActivity, Regulation and ModifiedResidue
 *
 * Built by copying fields across from the entry, each of which the entry may
 * not have: a field here may be present and undefined.
 */
export interface MolecularProcess extends DatabaseObject {
  reactions?: ReactionLikeEvent[] | undefined;

  // CatalystActivity
  type: string;
  activity?: GO_MolecularFunction | undefined;
  ecNumber?: string | undefined;
  activeUnit?: PhysicalEntity[] | undefined;
  catalyst?: PhysicalEntity | undefined;
  catalystActivityReference?: CatalystActivityReference | undefined;
  isCatalystActivity?: boolean | undefined;
  // Regulation
  regulator?: PhysicalEntity | undefined;
  regulationReference?: RegulationReference[] | undefined;
  go_BiologicalProcess?: GO_MolecularFunction | undefined;
  isRegulation?: boolean | undefined;
  // Modifications
  name?: string | undefined;
  psiMod?: PsiMod[] | undefined; // ReplacedResidue has multiple PsiMod
  coordinate?: number | undefined;
  modification?: EntitySet | Polymer | ReferenceGroup | ReferenceMolecule | undefined;
  isModification?: boolean | undefined;
}
