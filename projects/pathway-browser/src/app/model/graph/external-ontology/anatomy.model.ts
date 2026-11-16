import type * as Graph from '../../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** An anatomy term, as the pathway browser reads it (the contract's, resolved). */
export type Anatomy = Resolved<Graph.Anatomy<JsogReference>>;
