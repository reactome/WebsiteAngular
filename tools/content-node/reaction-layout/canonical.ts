/**
 * The site's canonical form of a reaction's layout, copied (research D21,
 * D22): projects/pathway-browser/src/app/details/common/reaction-diagram/
 * canonical-reaction.ts. The service may not import site code, so the
 * reaction layout comparison uses this copy, and canonical.spec.ts runs both
 * on the same answers and requires the same result. The code is the site's,
 * line for line; only the types are this module's, read from the answer as
 * it is (a field Jackson left out is undefined here too).
 */

interface Point {
  x: number;
  y: number;
}
interface Segment {
  from: Point;
  to: Point;
}
interface Part {
  id: number;
}
interface Placed {
  id: number;
  reactomeId: number;
  renderableClass: string;
  position: Point;
}
interface Connector {
  edgeId: number;
  type: string;
  segments: Segment[];
}
export interface CanonicalDiagram {
  compartments: (Placed & { componentIds: number[] })[];
  nodes: (Placed & { connectors: Connector[] })[];
  edges: (Placed & {
    inputs?: Part[];
    outputs?: Part[];
    catalysts?: Part[];
    inhibitors?: Part[];
    activators?: Part[];
  })[];
  links: {
    id: number;
    renderableClass: string;
    segments: Segment[];
    inputs?: Part[];
    outputs?: Part[];
  }[];
}
export interface CanonicalGraph {
  nodes: { dbId: number; diagramIds?: number[] }[];
  edges: { dbId: number }[];
}

const CONNECTOR_LISTS = ['inputs', 'outputs', 'catalysts', 'inhibitors', 'activators'] as const;

export function canonicalReaction<D extends CanonicalDiagram, G extends CanonicalGraph>(
  answered: D,
  answeredGraph: G
): { diagram: D; graph: G } {
  // A copy, renumbered in place: what the service sent is left as it came.
  const diagram = structuredClone(answered);
  const graph = structuredClone(answeredGraph);

  const byPlace = <T extends Placed>(items: T[]) =>
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

  const renumber = (connectors: Part[] | undefined) => {
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
