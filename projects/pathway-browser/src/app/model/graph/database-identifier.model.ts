import type * as Graph from '../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import type { Resolved } from '../../utils/JSOGDeserializer';

/** An identifier in another database, as the pathway browser reads it (the contract's, resolved). */
export type DatabaseIdentifier = Resolved<Graph.DatabaseIdentifier<JsogReference>>;
