import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A pathway, a top-level pathway or a cell lineage path, as the pathway browser reads it (the contract's, resolved). */
export type Pathway = Resolved<Graph.AnyPathway<JsogReference>>;
