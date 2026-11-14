import type { NodeSingular } from 'cytoscape';
import type { Graph } from '../model/graph.model';

/**
 * What the analysis found for one drawn entity: a value per leaf it stands for,
 * found ones first and in order, `undefined` for a leaf the analysis did not hit.
 *
 * An entity with no graph data is not hit. An inferred species' diagram is the
 * human layout, and an entity with no counterpart in that species has none (the
 * diagram service says so on the console). Reading it as a leaf threw, inside
 * the subscription that colours the diagram, so a mouse diagram with any token
 * was left uncoloured, and the render page waited for a colouring that never
 * came until the render service answered 500.
 */
export function nodeExpression(
  node: NodeSingular,
  found: ReadonlyMap<string, number>
): (number | undefined)[] {
  const own: unknown = node.data('graph');
  const given: unknown = node.data('graph.leaves');
  // As a drawn entity whose graph data has no identifier.
  if (!Array.isArray(given) && !isGraphNode(own)) return [undefined];
  const leaves = Array.isArray(given) ? given.filter(isGraphNode) : isGraphNode(own) ? [own] : [];
  return leaves
    .map((leaf) => (leaf.identifier ? found.get(leaf.identifier) : undefined))
    .sort((a, b) => (a !== undefined ? (b !== undefined ? a - b : -1) : 1));
}

function isGraphNode(value: unknown): value is Graph.Node {
  return typeof value === 'object' && value !== null;
}
