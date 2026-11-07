import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A gene product, or an isoform of one, as the pathway browser reads it (the contract's, resolved). */
export type ReferenceGeneProduct = Resolved<Graph.AnyReferenceGeneProduct<JsogReference>>;
