import type * as Graph from '../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import type { Resolved } from '../../utils/JSOGDeserializer';

/** How far an event's curation has been reviewed, as the pathway browser reads it (the contract's, resolved). */
export type ReviewStatus = Resolved<Graph.ReviewStatus<JsogReference>>;
