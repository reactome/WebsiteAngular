import type * as Graph from '../../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/** A book or a chapter, as the pathway browser reads it (the contract's, resolved). */
export type Book = Resolved<Graph.Book<JsogReference>>;
