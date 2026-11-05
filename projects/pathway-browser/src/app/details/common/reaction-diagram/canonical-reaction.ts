import { Diagram, EdgeConnector, Entity } from '../../../model/diagram.model';
import { Graph } from '../../../model/graph.model';

const CONNECTOR_LISTS = ['inputs', 'outputs', 'catalysts', 'inhibitors', 'activators'] as const;

/**
 * A reaction's layout in one form, whatever order and ids the service sent.
 *
 * ContentService builds a reaction's layout on every request. It numbers the
 * layout's ids from a counter that runs across requests, and lists the nodes in
 * an order that varies, so the same reaction comes back different each time. The
 * drawing follows that order, and two downloads of one reaction were different
 * files (specs/018-render-page-reuse, research R7).
 *
 * This sorts the compartments, nodes and edges by what they are and where they
 * sit, and the links by their kind and path, then renumbers the ids from 1 in that
 * order. Ids are only references
 * inside the layout, and to it from the graph's nodes (`diagramIds`), so nothing
 * outside changes. A graph edge's `diagramIds` are reaction dbIds, not layout ids,
 * and are left alone.
 */
export function canonicalReaction(
  answered: Diagram,
  answeredGraph: Graph.Data
): { diagram: Diagram; graph: Graph.Data } {
  // A copy, renumbered in place: what the service sent is left as it came.
  const diagram = structuredClone(answered);
  const graph = structuredClone(answeredGraph);

  const byPlace = <T extends Entity>(items: T[]) =>
    items.sort(
      (a, b) =>
        a.reactomeId - b.reactomeId ||
        a.position.x - b.position.x ||
        a.position.y - b.position.y ||
        a.renderableClass.localeCompare(b.renderableClass)
    );
  byPlace(diagram.compartments);
  byPlace(diagram.nodes);
  byPlace(diagram.edges);
  // A link has no reactomeId or position; its kind and its path are what it is.
  diagram.links.sort(
    (a, b) =>
      a.renderableClass.localeCompare(b.renderableClass) ||
      JSON.stringify(a.segments).localeCompare(JSON.stringify(b.segments))
  );

  const ids = new Map<number, number>();
  const id = (old: number) => {
    let next = ids.get(old);
    if (next === undefined) ids.set(old, (next = ids.size + 1));
    return next;
  };
  const ascending = (a: number, b: number) => a - b;

  // Numbered in the sorted order first, so a reference met later finds its own.
  const owners = [...diagram.compartments, ...diagram.nodes, ...diagram.edges, ...diagram.links];
  for (const owner of owners) owner.id = id(owner.id);

  const renumber = (connectors: EdgeConnector[] | undefined) => {
    if (!connectors) return;
    for (const connector of connectors) connector.id = id(connector.id);
    connectors.sort((a, b) => a.id - b.id);
  };
  for (const edge of diagram.edges) for (const list of CONNECTOR_LISTS) renumber(edge[list]);
  for (const link of diagram.links) {
    renumber(link.inputs);
    renumber(link.outputs);
  }
  for (const compartment of diagram.compartments) {
    compartment.componentIds = compartment.componentIds.map(id).sort(ascending);
  }
  for (const node of diagram.nodes) {
    for (const connector of node.connectors) connector.edgeId = id(connector.edgeId);
    node.connectors.sort(
      (a, b) =>
        a.edgeId - b.edgeId ||
        a.type.localeCompare(b.type) ||
        JSON.stringify(a.segments).localeCompare(JSON.stringify(b.segments))
    );
  }

  for (const node of graph.nodes) {
    if (node.diagramIds) node.diagramIds = node.diagramIds.map(id).sort(ascending);
  }
  graph.nodes.sort((a, b) => a.dbId - b.dbId);
  graph.edges.sort((a, b) => a.dbId - b.dbId);

  return { diagram, graph };
}
