// @vitest-environment node
//
// What the render endpoint accepts, and what it refuses.
//
// Refusing an unrecognised parameter is a deliberate reversal of the usual web
// convention, so it is worth asserting rather than leaving to a comment. The
// reason it matters twice over: an ignored parameter is a silent wrong answer
// (`?quality=10` served at the default size, 200, undetectable), and an
// unbounded set of accepted URLs is an unbounded set of cache entries for one
// picture -- `.png` is cached by extension on our zone, so only the response
// header currently keeps junk out of Cloudflare.
import { describe, expect, it } from 'vitest';
import { ACCEPTED, BOUNDS, canonicalUrl, inBounds } from './params.mjs';

describe('what the render endpoint accepts', () => {
  it('names every parameter the handler reads', () => {
    // If the handler grows one and this list does not, the new parameter is
    // refused in production while working in development -- so the list is the
    // contract rather than a convenience.
    expect(ACCEPTED).toEqual([
      'view',
      'select',
      'scale',
      'subpathways',
      'dark',
      'delay',
      'maxSize',
      'token',
    ]);
  });

  it('bounds every numeric parameter it accepts', () => {
    for (const key of Object.keys(BOUNDS)) expect(ACCEPTED).toContain(key);
  });
});

describe('bounds', () => {
  it('accepts values inside the range, including the ends', () => {
    expect(inBounds('scale', 0.25)).toBe(true);
    expect(inBounds('scale', 2)).toBe(true);
    expect(inBounds('scale', 1)).toBe(true);
  });

  it('refuses values outside it rather than clamping them', () => {
    // Clamping is what this replaced: `scale=4` used to return a smaller image
    // than asked for, with a 200 the caller could not distinguish from success.
    expect(inBounds('scale', 4)).toBe(false);
    expect(inBounds('scale', 0)).toBe(false);
  });

  it('refuses anything that is not a number', () => {
    expect(inBounds('scale', 'abc')).toBe(false);
    expect(inBounds('scale', '')).toBe(false);
    expect(inBounds('scale', NaN)).toBe(false);
    expect(inBounds('scale', Infinity)).toBe(false);
  });
});

describe('the canonical url offered back to a refused caller', () => {
  it('is the bare path when nothing usable was sent', () => {
    expect(canonicalUrl('R-HSA-109606', 'png', { bogus: '1' })).toBe('/render/R-HSA-109606.png');
  });

  it('keeps the parameters that were understood', () => {
    expect(canonicalUrl('R-HSA-109606', 'png', { scale: '1', bogus: '1' })).toBe(
      '/render/R-HSA-109606.png?scale=1'
    );
  });

  it('states them in one fixed order however they arrived', () => {
    // The point of offering it: two callers asking the same question land on
    // one cache entry rather than on a permutation of one.
    const a = canonicalUrl('R-HSA-1', 'png', { scale: '1', view: 'reaction' });
    const b = canonicalUrl('R-HSA-1', 'png', { view: 'reaction', scale: '1' });
    expect(a).toBe(b);
    expect(a).toBe('/render/R-HSA-1.png?view=reaction&scale=1');
  });

  it('drops a parameter whose value was out of range', () => {
    // Quoting it back would recommend the very URL just refused.
    expect(canonicalUrl('R-HSA-1', 'png', { scale: '9' })).toBe('/render/R-HSA-1.png');
  });

  it('encodes values rather than pasting them in', () => {
    expect(canonicalUrl('R-HSA-1', 'png', { token: 'a b&c=d' })).toBe(
      '/render/R-HSA-1.png?token=a%20b%26c%3Dd'
    );
  });
});
