import type * as Graph from '../../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** Any reaction-like event, as the pathway browser reads it (the contract's, resolved). */
export type ReactionLikeEvent = Resolved<Graph.ReactionLikeEvent<JsogReference>>;

/** A black-box event, as the pathway browser reads it (the contract's, resolved). */
export type BlackBoxEvent = Resolved<Graph.BlackBoxEvent<JsogReference>>;

/** A cell development step, as the pathway browser reads it (the contract's, resolved). */
export type CellDevelopmentStep = Resolved<Graph.CellDevelopmentStep<JsogReference>>;

/** A polymerisation, as the pathway browser reads it (the contract's, resolved). */
export type Polymerisation = Resolved<Graph.Polymerisation<JsogReference>>;

/** A depolymerisation, as the pathway browser reads it (the contract's, resolved). */
export type Depolymerisation = Resolved<Graph.Depolymerisation<JsogReference>>;

/** A failed reaction, as the pathway browser reads it (the contract's, resolved). */
export type FailedReaction = Resolved<Graph.FailedReaction<JsogReference>>;

/** A reaction, as the pathway browser reads it (the contract's, resolved). */
export type Reaction = Resolved<Graph.Reaction<JsogReference>>;
