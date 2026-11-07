import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A preceding event that is not one, and why, as the pathway browser reads it (the contract's, resolved). */
export type NegativePrecedingEvent = Resolved<Graph.NegativePrecedingEvent<JsogReference>>;
