import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** Any regulation, as the pathway browser reads it (the contract's, resolved). */
export type Regulation = Resolved<Graph.Regulation<JsogReference>>;
