import type * as Graph from '../../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A cell type, as the pathway browser reads it (the contract's, resolved). */
export type CellType = Resolved<Graph.CellType<JsogReference>>;
