import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** An RNA sequence, as the pathway browser reads it (the contract's, resolved). */
export type ReferenceRNASequence = Resolved<Graph.ReferenceRNASequence<JsogReference>>;
