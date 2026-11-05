import { describe, expect, it } from 'vitest';
import { Diagram } from '../../../model/diagram.model';
import { Graph } from '../../../model/graph.model';
import { canonicalReaction } from './canonical-reaction';

/**
 * One reaction as the service sends it, numbered from `base`: a compartment
 * holding an input and an output, and the reaction between them. `swap` lists
 * the nodes the other way round, as the service sometimes does.
 */
function answer(base: number, swap = false): { diagram: Diagram; graph: Graph.Data } {
  const [compartment, input, output, reaction] = [0, 1, 2, 3].map((i) => base + i);
  const node = (id: number, reactomeId: number, x: number, type: 'INPUT' | 'OUTPUT') => ({
    id,
    reactomeId,
    displayName: `entity ${reactomeId}`,
    position: { x, y: 100 },
    renderableClass: 'Protein',
    schemaClass: 'EntityWithAccessionedSequence',
    prop: { x: x - 20, y: 90, width: 40, height: 20 },
    connectors: [
      {
        edgeId: reaction,
        type,
        segments: [{ from: { x, y: 100 }, to: { x: 150, y: 100 } }],
        stoichiometry: { value: 1 },
      },
    ],
  });
  const nodes = [node(input, 11, 50, 'INPUT'), node(output, 12, 250, 'OUTPUT')];
  return {
    diagram: {
      displayName: 'a reaction',
      dbId: 99,
      stableId: 'R-HSA-99',
      links: [],
      shadows: [],
      compartments: [
        {
          id: compartment,
          reactomeId: 7,
          displayName: 'cytosol',
          position: { x: 150, y: 100 },
          renderableClass: 'Compartment',
          schemaClass: 'Compartment',
          componentIds: swap ? [reaction, output, input] : [input, output, reaction],
          prop: { x: 0, y: 0, width: 300, height: 200 },
          textPosition: { x: 10, y: 190 },
        },
      ],
      nodes: swap ? nodes.reverse() : nodes,
      edges: [
        {
          id: reaction,
          reactomeId: 99,
          displayName: 'a reaction',
          position: { x: 150, y: 100 },
          renderableClass: 'Reaction',
          schemaClass: 'Reaction',
          reactionShape: { type: 'BOX' },
          segments: [],
          inputs: [{ id: input }],
          outputs: [{ id: output }],
        },
      ],
    },
    graph: {
      dbId: 99,
      stId: 'R-HSA-99',
      speciesName: 'Homo sapiens',
      nodes: (swap ? [12, 11] : [11, 12]).map((dbId) => ({
        dbId,
        stId: `R-HSA-${dbId}`,
        displayName: `entity ${dbId}`,
        schemaClass: 'EntityWithAccessionedSequence',
        diagramIds: [dbId === 11 ? input : output],
      })),
      edges: [
        {
          dbId: 99,
          stId: 'R-HSA-99',
          displayName: 'a reaction',
          schemaClass: 'Reaction',
          diagramIds: [99],
        } as Graph.Edge,
      ],
    },
  };
}

/** The one item of a list the test expects to hold exactly one. */
function only<T>(items: T[] | undefined): T {
  if (items?.length !== 1) throw new Error(`expected one item, got ${items?.length ?? 'none'}`);
  return items[0] as T;
}

describe('canonicalReaction', () => {
  it('gives one form whatever ids the service numbered from', () => {
    expect(canonicalReaction(answer(149722).diagram, answer(149722).graph)).toEqual(
      canonicalReaction(answer(149729).diagram, answer(149729).graph)
    );
  });

  it('gives one form whatever order the nodes came in', () => {
    const a = answer(149722);
    const b = answer(149722, true);
    expect(canonicalReaction(b.diagram, b.graph)).toEqual(canonicalReaction(a.diagram, a.graph));
  });

  it('keeps every reference pointing at the same thing', () => {
    const { diagram, graph } = canonicalReaction(
      answer(149729, true).diagram,
      answer(149729, true).graph
    );
    const byId = new Map(diagram.nodes.map((n) => [n.id, n.reactomeId]));
    const reaction = only(diagram.edges);
    expect(byId.get(only(reaction.inputs).id)).toBe(11);
    expect(byId.get(only(reaction.outputs).id)).toBe(12);
    for (const n of diagram.nodes) expect(only(n.connectors).edgeId).toBe(reaction.id);
    for (const g of graph.nodes) expect(byId.get(only(g.diagramIds))).toBe(g.dbId);
    expect(only(diagram.compartments).componentIds).toEqual(
      [...diagram.nodes.map((n) => n.id), reaction.id].sort((a, b) => a - b)
    );
  });

  it("leaves a graph edge's diagramIds, which are reaction dbIds", () => {
    const { graph } = canonicalReaction(answer(149729).diagram, answer(149729).graph);
    expect((only(graph.edges) as Graph.Edge & { diagramIds: number[] }).diagramIds).toEqual([99]);
  });

  it('still tells two different layouts apart', () => {
    const a = answer(149722);
    const b = answer(149722);
    only(b.diagram.nodes.slice(0, 1)).position.y = 116;
    expect(canonicalReaction(b.diagram, b.graph)).not.toEqual(
      canonicalReaction(a.diagram, a.graph)
    );
  });
});
