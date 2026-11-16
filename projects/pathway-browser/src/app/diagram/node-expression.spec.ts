import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { nodeExpression } from './node-expression';

function node(data: Record<string, unknown>) {
  return cytoscape({ headless: true, elements: [{ data: { id: 'n', ...data } }] }).$id('n');
}

describe("a drawn entity's analysis values", () => {
  const found = new Map([
    ['P1', 0.5],
    ['P2', 0.1],
  ]);

  it('reads its leaves, found ones first and in order', () => {
    const leaves = [{ identifier: 'P3' }, { identifier: 'P1' }, { identifier: 'P2' }];
    expect(nodeExpression(node({ 'graph.leaves': leaves }), found)).toEqual([0.1, 0.5, undefined]);
    expect(nodeExpression(node({ 'graph.leaves': [] }), found)).toEqual([]);
  });

  it('reads the entity itself when it has no leaves', () => {
    expect(nodeExpression(node({ graph: { identifier: 'P1' } }), found)).toEqual([0.5]);
    expect(nodeExpression(node({ graph: {} }), found)).toEqual([undefined]);
  });

  // An inferred species' diagram is the human layout, and an entity with no
  // counterpart in that species has no graph data. Reading it threw, which left
  // the whole diagram uncoloured, and the render page waiting for a colouring
  // that never came until the render service gave up with a 500 (mouse
  // R-MMU-8864260 with any token).
  it('is not hit when the entity has no graph data', () => {
    expect(nodeExpression(node({}), found)).toEqual([undefined]);
  });
});
