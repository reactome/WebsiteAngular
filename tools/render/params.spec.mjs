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
import { readFileSync } from 'node:fs';
import {
  ACCEPTED,
  BOUNDS,
  ENUMS,
  REACTION_CLASSES,
  badEnums,
  canonicalUrl,
  inBounds,
  repeated,
} from './params.mjs';

describe('what the render endpoint accepts', () => {
  it('names every parameter the handler reads, checked against the handler', () => {
    // Asserting a literal list only catches someone editing the list. This
    // reads what `service.mjs` actually pulls out of the query string, so a
    // parameter added to the handler and not to ACCEPTED fails here -- which is
    // the real failure: it would work in development and be refused in
    // production, since nothing in the handler rejects on its own.
    const handler = readFileSync(new URL('./service.mjs', import.meta.url), 'utf8');
    const read = [...handler.matchAll(/req\.query\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(read.length, 'the handler reads the query string at all').toBeGreaterThan(0);
    for (const name of new Set(read)) expect(ACCEPTED).toContain(name);
  });

  it('bounds every numeric parameter it accepts', () => {
    for (const key of Object.keys(BOUNDS)) expect(ACCEPTED).toContain(key);
  });

  it('constrains every closed-set parameter it accepts', () => {
    // An enum for a parameter that is not accepted is dead configuration: the
    // parameter is refused by name before its value is ever looked at, so the
    // rule would never run and nobody would know.
    for (const key of Object.keys(ENUMS)) expect(ACCEPTED).toContain(key);
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

describe('values from a closed set', () => {
  it('accepts the values it names', () => {
    expect(badEnums({ view: 'reaction', subpathways: 'false', dark: 'true' })).toEqual([]);
  });

  it('refuses a boolean that is not true or false, rather than guessing', () => {
    // `subpathways` was `!== 'false'`, so this meant *true* -- the opposite of
    // what was asked, with a 200.
    expect(badEnums({ subpathways: 'no' })).toEqual(['"subpathways" must be "true" or "false"']);
    // `dark` was `=== 'true'`, so this meant *false*.
    expect(badEnums({ dark: 'yes' })).toEqual(['"dark" must be "true" or "false"']);
  });

  it('refuses a view it does not draw', () => {
    expect(badEnums({ view: 'banana' })).toEqual(['"view" must be "reaction"']);
  });

  it('says every problem at once, not the first', () => {
    expect(badEnums({ dark: 'yes', view: 'banana' })).toHaveLength(2);
  });

  it('ignores parameters it has no closed set for', () => {
    // `select` and `token` are deliberately unchecked: one is handed to the
    // diagram's own lookup, the other is opaque.
    expect(badEnums({ select: 'anything at all', token: 'x' })).toEqual([]);
  });
});

describe('the classes view=reaction can mean something for', () => {
  it('holds the six the graph reports, including the two easily forgotten', () => {
    expect([...REACTION_CLASSES].sort()).toEqual([
      'BlackBoxEvent',
      'CellDevelopmentStep',
      'Depolymerisation',
      'FailedReaction',
      'Polymerisation',
      'Reaction',
    ]);
  });

  it('excludes the pathway classes, which is the case that used to hang', () => {
    for (const c of ['Pathway', 'TopLevelPathway', 'CellLineagePath']) {
      expect(REACTION_CLASSES.has(c)).toBe(false);
    }
  });
});

describe('a parameter given more than once', () => {
  it('is named, so the caller is not left guessing which one was taken', () => {
    expect(repeated({ dark: ['true', 'false'] })).toEqual(['dark']);
  });

  it('catches token, which used to be dropped silently', () => {
    // `typeof req.query.token === 'string' ? … : ''` -- an array failed the
    // check and became the empty string, so the figure rendered with no
    // analysis overlay and a 200.
    expect(repeated({ token: ['a', 'b'] })).toEqual(['token']);
  });

  it('passes a single value of each', () => {
    expect(repeated({ dark: 'true', token: 'a', scale: '2' })).toEqual([]);
  });

  it('is left out of the canonical url, which has no single value to offer', () => {
    expect(canonicalUrl('R-HSA-1', 'png', { token: ['a', 'b'], scale: '1' })).toBe(
      '/render/R-HSA-1.png?scale=1'
    );
  });
});
