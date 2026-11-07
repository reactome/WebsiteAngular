import type * as Graph from '../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import { DatabaseObject } from './database-object.model';
import type { TreeMolecule } from '../participant.model';
import type { Resolved } from '../../utils/JSOGDeserializer';

export namespace Relationship {
  /**
   * A relationship entry as the pathway browser's trees hold any of them:
   * an element, how many times, in what order, of what type; with the
   * position and display state the trees add.
   */
  export interface Has<O extends DatabaseObject | TreeMolecule, Type extends string = string> {
    type: Type;
    stoichiometry: number;
    order: number;
    element: O;
    /** Its position, which the pathway browser sets: never sent. */
    index?: number;
    // Participants(Molecules) on Molecule tab
    moleculeView?: boolean;
    highlight?: boolean;
  }

  /** A compartment an event or an entity is in, as the contract's entry, resolved. */
  export type HasCompartment = Resolved<Graph.HasCompartment<JsogReference>>;

  /** A residue an entity is modified at, as the contract's entry, resolved. */
  export type HasModifiedResidue = Resolved<Graph.HasModifiedResidue<JsogReference>>;
}
