import { describe, expect, it } from 'vitest';
import { entitySet } from './entity-sets-shape';

// The drawer reads each property through extract(), which takes plain values
// as well as providers, so plain values are enough here.
const properties = {
  global: {
    selectNode: '#0af',
    hoverNode: '#fa0',
    flag: '#f0f',
    thickness: 2,
    negativeContrast: '#000',
  },
  entitySet: { radius: 4, fill: '#ccc', stroke: '#333', drug: '#c0c' },
  interactor: { fill: '#eee' },
} as never;

const decorator = (lossOfFunction: boolean): string => {
  const drawn = entitySet(properties, { width: 120, height: 40, lossOfFunction } as never);
  return String(drawn.decorators?.[0]?.['background-image'] ?? '');
};

describe('an entity set', () => {
  it('is drawn with no dashes ordinarily', () => {
    expect(decorator(false)).not.toContain('stroke-dasharray');
  });

  // It computed the dashes and never drew them, so all 268 loss-of-function
  // sets in release 97 looked like any other set (#334).
  it('dashes the stretch between its braces when it is a loss of function', () => {
    const svg = decorator(true);
    const dashLength = Number(/stroke-dasharray="([\d.]+)"/.exec(svg)?.[1]);
    expect(dashLength, 'a dashed path').toBeGreaterThan(0);

    // Between the braces: from bracesOffset to width - bracesOffset, where the
    // drawer widens the set by 2r first. r = 4, t = 2: bracesOffset = 2r + 2t.
    const width = 120 + 2 * 4;
    const bracesOffset = 2 * 4 + 2 * 2;
    expect(svg).toContain(`M ${bracesOffset} 2 H ${width - bracesOffset}`);

    // A whole number of dashes as long as the gaps, starting and ending on a
    // dash: the stretch is an odd number of dash lengths.
    const stretch = width - 2 * bracesOffset;
    const segments = stretch / dashLength;
    expect(Math.abs(segments - Math.round(segments))).toBeLessThan(1e-9);
    expect(Math.round(segments) % 2).toBe(1);
  });
});
