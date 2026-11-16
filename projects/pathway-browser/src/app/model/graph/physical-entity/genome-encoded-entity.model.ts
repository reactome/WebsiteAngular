import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A genome-encoded entity, as the pathway browser reads it (the contract's, resolved). */
export type GenomeEncodedEntity = Resolved<Graph.GenomeEncodedEntity<JsogReference>>;
