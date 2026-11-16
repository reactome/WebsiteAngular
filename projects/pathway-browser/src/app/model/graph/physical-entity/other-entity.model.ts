import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** An entity of no other class, as the pathway browser reads it (the contract's, resolved). */
export type OtherEntity = Resolved<Graph.OtherEntity<JsogReference>>;
