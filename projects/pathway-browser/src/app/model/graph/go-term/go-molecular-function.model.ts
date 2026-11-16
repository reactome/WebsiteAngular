import type * as Graph from '../../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A GO molecular function, as the pathway browser reads it (the contract's, resolved). */
export type GO_MolecularFunction = Resolved<Graph.GO_MolecularFunction<JsogReference>>;
