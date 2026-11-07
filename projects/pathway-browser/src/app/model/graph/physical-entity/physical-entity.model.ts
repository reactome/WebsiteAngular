import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/**
 * Any physical entity, as the pathway browser reads it (the contract's,
 * resolved), and the summary of one, which it treats as one: Java's
 * SummaryEntity is not a PhysicalEntity, but stands in for one on the page.
 */
export type PhysicalEntity = Resolved<
  Graph.PhysicalEntity<JsogReference> | Graph.SummaryEntity<JsogReference>
>;
