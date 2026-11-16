import type * as Graph from '../../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../../contract/graph.ts';
import type { Resolved } from '../../../utils/JSOGDeserializer';

/**
 * What the curation graph's service writes on a publication besides the
 * public content service's fields: the authors' names as written, one entry
 * per author (`["Kerr, JF", "Wyllie, AH"]`). The public service writes no such
 * field (neither its domain snapshot nor any recorded answer has it), and the
 * pathway browser reads it only when `author` is absent.
 */
interface CurationPublication {
  authorName?: string | string[];
}

/** A publication, as the pathway browser reads it (the contract's, resolved), from either service. */
export type Publication = Resolved<Graph.Publication<JsogReference>> & CurationPublication;
