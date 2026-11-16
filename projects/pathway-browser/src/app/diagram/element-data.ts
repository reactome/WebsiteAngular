import type { Core, EdgeCollection, NodeSingular } from 'cytoscape';
import { Style } from 'ngx-reactome-cytoscape-style';
import type * as Graph from '../model/graph.model';
import type { DrawnInteractor } from '../interactors/model/interactor.model';

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

interface WithAllData {
  data(): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Everything kept on an element, to copy onto another; nothing where it is not an object. */
export function allData(element: WithAllData): Record<string, unknown> {
  const data = element.data();
  return isRecord(data) ? data : {};
}

/** The value under `name` where it is an object, to copy onto another element. */
export function recordData(element: WithData, name: string): Record<string, unknown> | undefined {
  const value = element.data(name);
  return isRecord(value) ? value : undefined;
}

/** The value under `name` where it is a list. */
export function listData(element: WithData, name: string): unknown[] | undefined {
  const value: unknown = element.data(name);
  return Array.isArray(value) ? value : undefined;
}

/**
 * The value under `name` where it is a cytoscape node, as an interactor
 * occurrence keeps its entity (`entity`).
 */
export function nodeData(element: WithData, name: string): NodeSingular | undefined {
  const value = element.data(name);
  return isNodeSingular(value) ? value : undefined;
}

function isNodeSingular(value: unknown): value is NodeSingular {
  return (
    isRecord(value) &&
    typeof value['isNode'] === 'function' &&
    typeof value['position'] === 'function' &&
    typeof value['id'] === 'function'
  );
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

/**
 * An interactor occurrence's interactors, as the interactor service puts them
 * there: the entries with an accession, which is what drawing reads of each.
 */
export function drawnInteractors(occurrence: WithData): DrawnInteractor[] {
  return (listData(occurrence, 'interactors') ?? []).filter(isDrawnInteractor);
}

function isDrawnInteractor(value: unknown): value is DrawnInteractor {
  return isRecord(value) && typeof value['acc'] === 'string';
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
