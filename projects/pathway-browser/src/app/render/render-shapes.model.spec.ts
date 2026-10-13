import { describe, expect, it } from 'vitest';
import { gatherGroups } from './render-shapes.model';

describe('gatherGroups', () => {
  it("brings a group's shapes together where its first one was", () => {
    const shapes = [
      { id: 'compartment' },
      { id: 'line', group: 'reaction-1' },
      { id: 'other line', group: 'reaction-2' },
      { id: 'arrowhead', group: 'reaction-1' },
      { id: 'node', group: 'reaction-1' },
      { id: 'entity', group: 'entity-9' },
    ];
    expect(gatherGroups(shapes).map((shape) => shape.id)).toEqual([
      'compartment',
      'line',
      'arrowhead',
      'node',
      'other line',
      'entity',
    ]);
  });

  it('leaves shapes that belong to nothing where they were', () => {
    const shapes = [{ id: 'a' }, { id: 'b', group: 'g' }, { id: 'c' }];
    expect(gatherGroups(shapes).map((shape) => shape.id)).toEqual(['a', 'b', 'c']);
  });
});
