import type { GraphObject } from '../../../../../contract/graph-core.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import type { Resolved } from '../../utils/JSOGDeserializer';

/**
 * Any object of the graph, as the pathway browser reads it: the contract's
 * GraphObject, resolved, with what the pathway browser adds to it
 * (ObjectState). It used to take any field at all (`[key: string]: any`).
 */
export type DatabaseObject = Resolved<GraphObject<JsogReference>>;
