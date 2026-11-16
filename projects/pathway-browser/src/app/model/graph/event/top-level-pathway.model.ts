import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A top-level pathway, as the pathway browser reads it (the contract's, resolved). */
export type TopLevelPathway = Resolved<Graph.TopLevelPathway<JsogReference>>;

/**
 * A top-level pathway as /data/pathways/top/{taxId} writes it: the plain form,
 * in which a species the answer has written already is repeated as its dbId.
 */
export type PlainTopLevelPathway = Graph.TopLevelPathway<number>;
