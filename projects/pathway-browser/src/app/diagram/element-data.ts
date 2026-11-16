import type { Core, EdgeCollection } from 'cytoscape';
import { Style } from 'ngx-reactome-cytoscape-style';
import type * as Graph from '../model/graph.model';

/**
 * Reading what the diagram keeps on its cytoscape elements.
 *
 * Cytoscape types every `data(name)` as `any`. What is stored there is the
 * diagram service's (ids, names, graph nodes) and the style library's (its
 * `Style`, a sub-pathway's edges), so these read it as `unknown` and take what
 * the caller can use: anything else reads as absent.
 */
interface WithData {
  data(name: string): unknown;
}

/** The value under `name` where it is text. */
export function textData(element: WithData, name: string): string | undefined {
  const value = element.data(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * The stable id a selection in the diagram selects: the first element's (a
 * reaction's line is selected as its node), or none for an entity without one,
 * as in an inferred species' diagram where it has no counterpart.
 */
export function selectedStId(selected: WithData): string | null {
  return textData(selected, 'graph.stId') ?? null;
}

/** The value under `name` where it is a number. */
export function numberData(element: WithData, name: string): number | undefined {
  const value = element.data(name);
  return typeof value === 'number' ? value : undefined;
}

/** A graph node, as the diagram service puts one on an element (`graph`, `graph.leaves`). */
export function isGraphNode(value: unknown): value is Graph.Node {
  return typeof value === 'object' && value !== null;
}

/** The entity's leaves, where it has a list of them; their entries that are graph nodes. */
export function graphLeaves(element: WithData): Graph.Node[] | undefined {
  const leaves = element.data('graph.leaves');
  return Array.isArray(leaves) ? leaves.filter(isGraphNode) : undefined;
}

/** The style bound to a diagram: the library keeps it as the graph's `reactome` data. */
export function styleOf(cy: Core): Style | undefined {
  const style: unknown = cy.data('reactome');
  return style instanceof Style ? style : undefined;
}

/**
 * A sub-pathway's reaction edges, which the style library keeps on its shadow
 * node as `edges`.
 */
export function shadowEdges(shadow: WithData): EdgeCollection | undefined {
  const edges = shadow.data('edges');
  return isEdgeCollection(edges) ? edges : undefined;
}

function isEdgeCollection(value: unknown): value is EdgeCollection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'style' in value &&
    typeof value.style === 'function'
  );
}

/** The accessions of an interactor occurrence's interactors, where they are text. */
export function interactorAccessions(occurrence: WithData): string[] {
  const interactors = occurrence.data('interactors');
  if (!Array.isArray(interactors)) return [];
  return interactors.flatMap((interactor: unknown) =>
    typeof interactor === 'object' &&
    interactor !== null &&
    'acc' in interactor &&
    typeof interactor.acc === 'string'
      ? [interactor.acc]
      : []
  );
}
