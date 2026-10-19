import { Diagram } from './diagram.model';
import { Graph } from './graph.model';

/** A reaction's own layout: a diagram without the lists it has no use for. */
export interface ReactionJson {
  diagram: Omit<Diagram, 'links' | 'shadows' | 'compartments'> &
    Partial<Pick<Diagram, 'links' | 'shadows' | 'compartments'>>;
  graph: Graph.Data;
}
