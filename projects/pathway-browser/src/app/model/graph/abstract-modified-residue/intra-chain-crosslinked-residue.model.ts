import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A residue crosslinked within a chain, as the pathway browser reads it (the contract's, resolved). */
export type IntraChainCrosslinkedResidue = Resolved<
  Graph.IntraChainCrosslinkedResidue<JsogReference>
>;
