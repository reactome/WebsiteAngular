// @vitest-environment node
//
// The reaction layout comparison's copy of the site's canonical form
// (research D22): both run on the same answers, and must give the same
// result. The answers are invented, in the shapes Java's take: lists left
// out when empty, compartments only the GO tree supplies with no reactomeId,
// and many elements tied on the sort keys, whose input order then decides.
import { describe, expect, it } from 'vitest';
import { canonicalReaction as site } from '../../../projects/pathway-browser/src/app/details/common/reaction-diagram/canonical-reaction.ts';
import { canonicalReaction as copy } from './canonical.ts';
import type { CanonicalDiagram, CanonicalGraph } from './canonical.ts';

/** A small deterministic generator, so a failure can be run again. */
function random(seed: number) {
  let state = seed;
  return (n: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % n;
  };
}

const TYPES = ['INPUT', 'OUTPUT', 'CATALYST', 'INHIBITOR', 'ACTIVATOR'];
const CLASSES = ['Protein', 'Complex', 'Chemical', 'EntitySet'];

/** An answer as Java's diagram and graph might be, with ids from `base`. */
function answer(seed: number): { diagram: CanonicalDiagram; graph: CanonicalGraph } {
  const pick = random(seed);
  const base = 1000 + pick(100000);
  let next = base;
  const point = () => ({ x: pick(4) * 10, y: pick(3) * 10 });
  const segments = () =>
    Array.from({ length: 1 + pick(3) }, () => ({ from: point(), to: point() }));
  const edgeId = next++;
  const nodes = Array.from({ length: 1 + pick(8) }, () => ({
    id: next++,
    reactomeId: 100 + pick(3),
    renderableClass: CLASSES[pick(CLASSES.length)] as string,
    position: point(),
    connectors: Array.from({ length: 1 + pick(3) }, () => ({
      edgeId,
      type: TYPES[pick(TYPES.length)] as string,
      segments: segments(),
    })),
  }));
  const part = () => ({ id: (nodes[pick(nodes.length)] as { id: number }).id });
  const lists = Object.fromEntries(
    ['inputs', 'outputs', 'catalysts', 'inhibitors', 'activators']
      .filter(() => pick(2) === 1)
      .map((list) => [list, Array.from({ length: 1 + pick(3) }, part)])
  );
  const compartments = Array.from({ length: pick(4) }, () => ({
    id: next++,
    // A compartment only the GO tree supplies has no reactomeId: Jackson leaves it out.
    ...(pick(3) ? { reactomeId: 7 + pick(2) } : {}),
    renderableClass: 'Compartment',
    position: point(),
    componentIds: [] as number[],
  })) as CanonicalDiagram['compartments'];
  for (const compartment of compartments)
    compartment.componentIds = [edgeId, ...nodes.map((node) => node.id)].filter(
      () => pick(2) === 1
    );
  return {
    diagram: {
      compartments,
      nodes,
      edges: [
        { id: edgeId, reactomeId: 1, renderableClass: 'Reaction', position: point(), ...lists },
      ],
      links: [],
    },
    graph: {
      nodes: nodes.map((node) => ({ dbId: node.reactomeId, diagramIds: [node.id] })),
      edges: [{ dbId: 1 }],
    },
  };
}

describe("the comparison's canonical form", () => {
  it("is the site's, on answers with ties, absent lists and compartments without an id", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { diagram, graph } = answer(seed);
      const mine = copy(diagram, graph);
      const theirs = site(
        diagram as unknown as Parameters<typeof site>[0],
        graph as unknown as Parameters<typeof site>[1]
      );
      expect(JSON.stringify(mine), `seed ${seed}`).toBe(JSON.stringify(theirs));
    }
  });
});
