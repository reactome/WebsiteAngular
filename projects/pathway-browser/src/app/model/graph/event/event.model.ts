import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** Any event, as the pathway browser reads it (the contract's, resolved). */
export type Event = Resolved<Graph.Event<JsogReference>>;
