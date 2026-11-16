import type * as Graph from '../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import type { Resolved } from '../../utils/JSOGDeserializer';

/** An event's or an entity's description, as the pathway browser reads it (the contract's, resolved). */
export type Summation = Resolved<Graph.Summation<JsogReference>>;
