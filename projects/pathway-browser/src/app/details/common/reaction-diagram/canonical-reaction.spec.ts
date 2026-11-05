import { describe, expect, it } from 'vitest';
import { Diagram, Link, NodeConnector } from '../../../model/diagram.model';
import { Graph } from '../../../model/graph.model';
import { canonicalReaction } from './canonical-reaction';

/**
 * One reaction as the service sends it, numbered from `base`: a compartment
 * holding an entity drawn twice as input (once also its catalyst), an output, and
 * the reaction between them, and two links. `swap` gives every list the other way
 * round, as the service sometimes does.
 */
function answer(base: number, swap = false): { diagram: Diagram; graph: Graph.Data } {
  const [compartment, input, again, output, reaction, link, other] = [0, 1, 2, 3, 4, 5, 6].map(
    (i) => base + i
  );
  const order = <T>(items: T[]) => (swap ? [...items].reverse() : items);
  const connector = (type: NodeConnector['type'], x: number, y: number): NodeConnector => ({
    edgeId: reaction,
    type,
    segments: [{ from: { x, y }, to: { x: 150, y: 100 } }],
    stoichiometry: { value: 1 },
  });
  const node = (
    id: number,
    reactomeId: number,
    x: number,
    y: number,
    connectors: NodeConnector[]
  ) => ({
    id,
    reactomeId,
    displayName: `entity ${reactomeId}`,
    position: { x, y },
    renderableClass: 'Protein',
    schemaClass: 'EntityWithAccessionedSequence',
    prop: { x: x - 20, y: y - 10, width: 40, height: 20 },
    connectors,
  });
  const nodes = [
    node(input, 11, 50, 100, order([connector('INPUT', 50, 100), connector('CATALYST', 50, 100)])),
    node(again, 11, 50, 150, [connector('INPUT', 50, 150)]),
    node(output, 12, 250, 100, [connector('OUTPUT', 250, 100)]),
  ];
  const aLink = (id: number, x: number): Link => ({
    id,
    inputs: [{ id: input }],
    outputs: [{ id: output }],
    renderableClass: 'EntitySetAndMemberLink',
    segments: [{ from: { x, y: 0 }, to: { x, y: 10 } }],
  });
  return {
    diagram: {
      displayName: 'a reaction',
      dbId: 99,
      stableId: 'R-HSA-99',
      links: order([aLink(link, 10), aLink(other, 20)]),
      shadows: [],
      compartments: [
        {
          id: compartment,
          reactomeId: 7,
          displayName: 'cytosol',
          position: { x: 150, y: 100 },
          renderableClass: 'Compartment',
          schemaClass: 'Compartment',
          componentIds: order([input, again, output, reaction]),
          prop: { x: 0, y: 0, width: 300, height: 200 },
          textPosition: { x: 10, y: 190 },
        },
      ],
      nodes: order(nodes),
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
          inputs: order([{ id: input }, { id: again }]),
          outputs: [{ id: output }],
          catalysts: [{ id: input }],
        },
      ],
    },
    graph: {
      dbId: 99,
      stId: 'R-HSA-99',
      speciesName: 'Homo sapiens',
      nodes: order([
        {
          dbId: 11,
          stId: 'R-HSA-11',
          displayName: 'entity 11',
          schemaClass: 'EntityWithAccessionedSequence',
          diagramIds: order([input, again]),
        },
        {
          dbId: 12,
          stId: 'R-HSA-12',
          displayName: 'entity 12',
          schemaClass: 'EntityWithAccessionedSequence',
          diagramIds: [output],
        },
      ]),
      edges: order([
        {
          dbId: 98,
          stId: 'R-HSA-98',
          displayName: 'before',
          schemaClass: 'Reaction',
          diagramIds: [98],
        },
        {
          dbId: 99,
          stId: 'R-HSA-99',
          displayName: 'a reaction',
          schemaClass: 'Reaction',
          diagramIds: [99],
        },
      ] as Graph.Edge[]),
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

  it('gives one form whatever order its lists came in', () => {
    const a = answer(149722);
    const b = answer(149722, true);
    expect(canonicalReaction(b.diagram, b.graph)).toEqual(canonicalReaction(a.diagram, a.graph));
  });

  it('keeps every reference pointing at the same thing', () => {
    const { diagram, graph } = canonicalReaction(
      answer(149729, true).diagram,
      answer(149729, true).graph
    );
    const entity = new Map(diagram.nodes.map((n) => [n.id, n.reactomeId]));
    const reaction = only(diagram.edges);
    expect((reaction.inputs ?? []).map((c) => entity.get(c.id))).toEqual([11, 11]);
    expect(entity.get(only(reaction.outputs).id)).toBe(12);
    expect(entity.get(only(reaction.catalysts).id)).toBe(11);
    for (const n of diagram.nodes) for (const c of n.connectors) expect(c.edgeId).toBe(reaction.id);
    for (const g of graph.nodes) {
      for (const d of g.diagramIds ?? []) expect(entity.get(d)).toBe(g.dbId);
    }
    for (const l of diagram.links) {
      expect(entity.get(only(l.inputs).id)).toBe(11);
      expect(entity.get(only(l.outputs).id)).toBe(12);
    }
    expect(only(diagram.compartments).componentIds).toEqual(
      [...diagram.nodes.map((n) => n.id), reaction.id].sort((a, b) => a - b)
    );
  });

  it('leaves what the service sent as it came', () => {
    const sent = answer(149729, true);
    const before = structuredClone(sent);
    canonicalReaction(sent.diagram, sent.graph);
    expect(sent).toEqual(before);
  });

  it("leaves a graph edge's diagramIds, which are reaction dbIds", () => {
    const { graph } = canonicalReaction(answer(149729).diagram, answer(149729).graph);
    expect(graph.edges.map((e) => (e as Graph.Edge & { diagramIds: number[] }).diagramIds)).toEqual(
      [[98], [99]]
    );
  });

  it('still tells two different layouts apart', () => {
    const a = answer(149722);
    const b = answer(149722);
    only(b.diagram.nodes.slice(2)).position.y = 116;
    expect(canonicalReaction(b.diagram, b.graph)).not.toEqual(
      canonicalReaction(a.diagram, a.graph)
    );
  });
});
