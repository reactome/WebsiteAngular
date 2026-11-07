import type { ReactionLayout } from '../../../../../../contract/reaction-layout.ts';
import { Diagram } from '../../../model/diagram.model';
import { Graph } from '../../../model/graph.model';

/**
 * A reaction's layout, as the service answers it, in the form the diagram is
 * drawn from: a diagram file's. The layout leaves out a list it has nothing
 * in, which a diagram file gives empty, and has no links or shadows.
 */
export function drawableReaction({ diagram, graph }: ReactionLayout): {
  diagram: Diagram;
  graph: Graph.Data;
} {
  return {
    diagram: {
      ...diagram,
      nodes: diagram.nodes ?? [],
      compartments: diagram.compartments ?? [],
      links: [],
      shadows: [],
    },
    graph: { ...graph, nodes: graph.nodes ?? [] },
  };
}
