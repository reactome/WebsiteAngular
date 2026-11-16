import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A positive regulation, of genes or not, or a requirement, as the pathway browser reads it (the contract's, resolved). */
export type PositiveRegulation = Resolved<Graph.AnyPositiveRegulation<JsogReference>>;
