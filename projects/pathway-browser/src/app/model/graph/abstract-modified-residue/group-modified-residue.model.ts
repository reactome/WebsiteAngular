import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A residue modified by a group, as the pathway browser reads it (the contract's, resolved). */
export type GroupModifiedResidue = Resolved<Graph.GroupModifiedResidue<JsogReference>>;
