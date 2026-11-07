import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** Any reference sequence, as the pathway browser reads it (the contract's, resolved). */
export type ReferenceSequence = Resolved<Graph.ReferenceSequence<JsogReference>>;
