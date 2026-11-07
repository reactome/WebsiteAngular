import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A protein, gene or transcript with its sequence, as the pathway browser reads it (the contract's, resolved). */
export type EntityWithAccessionedSequence = Resolved<
  Graph.EntityWithAccessionedSequence<JsogReference>
>;
