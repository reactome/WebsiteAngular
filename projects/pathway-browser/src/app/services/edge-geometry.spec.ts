import { describe, expect, it } from 'vitest';
import { absoluteToRelative } from './edge-geometry';
import { addRoundness } from './roundness';
// What the vectorious-based versions answered for these inputs, recorded before
// they were rewritten in plain arithmetic: the rewrite has to answer the same.
import recorded from './edge-geometry.recorded.json';

/** Equal to within floating-point noise, at the scale of the values. */
function expectClose(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    const want = expected[i]!;
    expect(Math.abs(value - want)).toBeLessThan(1e-9 * Math.max(1, Math.abs(want)));
  });
}

describe('absoluteToRelative', () => {
  it('says how far along an edge, and how far off it, a point is', () => {
    const { weights, distances } = absoluteToRelative({ x: 0, y: 0 }, { x: 10, y: 0 }, [
      { x: 5, y: 3 },
      { x: 10, y: -2 },
      { x: -5, y: 0 },
    ]);
    expectClose(weights, [0.5, 1, -0.5]);
    // Perpendicular distance in pixels, signed by side.
    expectClose(distances, [3, -2, 0]);
  });

  it('measures along a slanted edge the same way', () => {
    const { weights, distances } = absoluteToRelative({ x: 1, y: 1 }, { x: 4, y: 5 }, [
      { x: 1 + 1.5 - 4 * 0.4, y: 1 + 2 + 3 * 0.4 },
    ]);
    expectClose(weights, [0.5]);
    expectClose(distances, [2]);
  });

  it('converts nothing for an edge with no length, or a point that is not finite', () => {
    expect(absoluteToRelative({ x: 1, y: 1 }, { x: 1, y: 1 }, [{ x: 2, y: 2 }])).toEqual({
      distances: [],
      weights: [],
    });
    expect(absoluteToRelative({ x: 0, y: 0 }, { x: 1, y: 0 }, [{ x: NaN, y: 1 }]).weights).toEqual(
      []
    );
  });

  it('answers what it answered before, for irregular edges and points', () => {
    for (const { source, target, points, relative } of recorded.cases) {
      const now = absoluteToRelative(source, target, points);
      expectClose(now.weights, relative.weights);
      expectClose(now.distances, relative.distances);
    }
  });
});

describe('addRoundness', () => {
  it('puts a point either side of each corner, a radius away along each segment', () => {
    const rounded = addRoundness({ x: 0, y: 0 }, { x: 100, y: 100 }, [{ x: 100, y: 0 }], 10);
    expect(rounded).toEqual([
      { x: 90, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
    ]);
  });

  it('answers what it answered before, for irregular corners', () => {
    for (const { source, target, anchors, radius, rounded } of recorded.rounds) {
      const now = addRoundness(source, target, anchors, radius);
      expectClose(
        now.flatMap((p) => [p.x, p.y]),
        rounded.flatMap((p) => [p.x, p.y])
      );
    }
  });
});
