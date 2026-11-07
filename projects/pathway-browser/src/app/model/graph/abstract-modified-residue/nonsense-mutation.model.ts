import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A nonsense mutation, as the pathway browser reads it (the contract's, resolved). */
export type NonsenseMutation = Resolved<Graph.NonsenseMutation<JsogReference>>;
