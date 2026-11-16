import type * as Graph from '../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import type { Resolved } from '../../utils/JSOGDeserializer';

/** An illustration, as the pathway browser reads it (the contract's, resolved). */
export type Figure = Resolved<Graph.Figure<JsogReference>>;
