import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** Any modified residue, as the pathway browser reads it (the contract's, resolved). */
export type AbstractModifiedResidue = Resolved<Graph.AbstractModifiedResidue<JsogReference>>;
