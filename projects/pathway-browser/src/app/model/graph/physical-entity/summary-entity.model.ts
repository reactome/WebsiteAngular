import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A summary of a reference entity and the entities it was read from, as the pathway browser reads it (the contract's, resolved). */
export type SummaryEntity = Resolved<Graph.SummaryEntity<JsogReference>>;
