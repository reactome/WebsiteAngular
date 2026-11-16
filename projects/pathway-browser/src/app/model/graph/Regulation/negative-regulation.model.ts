import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A negative regulation, of genes or not, as the pathway browser reads it (the contract's, resolved). */
export type NegativeRegulation = Resolved<Graph.AnyNegativeRegulation<JsogReference>>;
