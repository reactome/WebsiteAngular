import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A replaced residue, as the pathway browser reads it (the contract's, resolved). */
export type ReplacedResidue = Resolved<Graph.ReplacedResidue<JsogReference>>;
