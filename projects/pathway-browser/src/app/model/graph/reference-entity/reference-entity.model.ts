import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** Any reference entity, as the pathway browser reads it (the contract's, resolved). */
export type ReferenceEntity = Resolved<Graph.ReferenceEntity<JsogReference>>;
