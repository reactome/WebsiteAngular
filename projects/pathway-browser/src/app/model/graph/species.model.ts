import type * as Graph from '../../../../../contract/graph.ts';
import type { JsogReference } from '../../../../../contract/graph.ts';
import type { Resolved } from '../../utils/JSOGDeserializer';

/** A species, as the pathway browser reads it (the contract's, resolved). */
export type Species = Resolved<Graph.Species<JsogReference>>;

/** What the pathway browser adds to a species it lists. */
interface ShortName {
  /** "H. sapiens": made from the display name, never sent. */
  shortName: string;
}

/** A species of /data/species/main, as the species pickers list it. */
export type ListedSpecies = Species & ShortName;

/**
 * The species the pathway browser is showing: what its pickers read, which
 * is all its default (Homo sapiens, written by hand before the list arrives) has.
 */
export type ShownSpecies = Pick<
  ListedSpecies,
  'dbId' | 'displayName' | 'taxId' | 'abbreviation' | 'schemaClass' | 'shortName'
>;

export type OrthologousMap = Map<string, string | undefined>;
