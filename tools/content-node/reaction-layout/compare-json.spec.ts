// @vitest-environment node
//
// The reaction layout comparison's numbers (research D22): equal within a
// billionth of their size, so Java's last-bit sin and cos pass and nothing
// visible does.
import { describe, expect, it } from 'vitest';
import { sameWithin } from './compare-json.ts';

describe('sameWithin', () => {
  it('takes a last-bit difference as the same, as on a diagonal connector', () => {
    // Java's and Node's x of one catalyst line's end, a bit apart.
    expect(sameWithin({ x: 288.6301451057273 }, { x: 288.63014510572737 })).toBe(true);
  });

  it('finds any difference a drawing could show', () => {
    expect(sameWithin({ x: 288.63 }, { x: 288.64 })).toBe(false);
    expect(sameWithin({ x: 0 }, { x: 1e-6 })).toBe(false);
    // Just past a billionth of the value: two parts in a billion at 1000.
    expect(sameWithin({ x: 1000 }, { x: 1000.000002 })).toBe(false);
    expect(sameWithin([1, 2], [1, 2, 3])).toBe(false);
    expect(sameWithin({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameWithin({ a: '1' }, { a: 1 })).toBe(false);
    expect(sameWithin({ a: [{ b: 'x' }] }, { a: [{ b: 'x' }] })).toBe(true);
  });
});
