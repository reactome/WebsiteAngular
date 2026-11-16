// @vitest-environment node
//
// Step 3 of the reaction layout (research D22): where one compartment's box
// goes beside another's, as reaction-exporter's PlacePositioner decides from
// the places each box's roles take. The table is the deployed jar's own
// answer for every pair of sets of places, printed under JDK 11.
import { describe, expect, it } from 'vitest';
import { relativePosition, simplify } from './place.ts';
import type { Place } from './place.ts';

/** Place's declaration order: bit i of a mask is PLACES[i]. */
const PLACES: Place[] = ['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'CENTER'];

/**
 * getRelativePosition(a, b) for a mask by b mask, a in the outer loop:
 * L, R, T, B, or - for null.
 */
const JAVA = [
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-TRTRTRTRTLTLTBT-TRTRTRTRTLTLTTT-',
  'BBRRBBRRBBLLBBT-BBRRBBRRBBLLBBB-RRRRRRRRLLLLTBT-RRRRRRRRLLLLRRR-',
  'LLLLBBTRLLLLBBT-LLLLBBTLLLLLBBT-TLTLTBTRTLTLTBT-TLTLTTTTTLTLTTT-',
  'BBLLBBTRBBLLBBT-BBLLBBBBBBLLBBB-LLLLRBTRLLLLTBT-LLLLLLLLLLLLLLL-',
  'RRRRRRRRBBTLBBT-RRRRRRRRBBTRBBT-TRTRTRTRTBTLTBT-TRTRTRTRTTTTTTT-',
  'BBRRBBRRBBTLBBT-BBRRBBRRBBBBBBB-RRRRRRRRLBTLTBT-RRRRRRRRRRRRRRR-',
  'BBTLBBTRBBTLBBT-BBTBBBTBBBTBBBT-TBTLTBTRTBTLTBT-TTTTTTTTTTTTTTT-',
  'BBTLBBTRBBTLBBT-BBBBBBBBBBBBBBB-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
  'LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-LBTLRBTRLBTLTBT-',
].join('');

// Filled in reverse: Java's EnumSets iterate in declaration order whatever order they were filled in.
const set = (mask: number) => new Set(PLACES.filter((_, i) => mask & (1 << i)).reverse());
const letter = (place: Place | null) => (place === null ? '-' : place[0]);

describe('where a box goes beside another', () => {
  it('is what Java answers, for every pair of sets of places', () => {
    let answers = '';
    for (let a = 0; a < 32; a += 1)
      for (let b = 0; b < 32; b += 1) answers += letter(relativePosition(set(a), set(b)));
    expect(answers).toBe(JAVA);
  });
});

describe('simplify', () => {
  it('counts a positive regulator as a negative one', () => {
    expect([...simplify(new Set(['positive', 'input']))].sort()).toEqual(['input', 'negative']);
    expect([...simplify(new Set(['negative']))]).toEqual(['negative']);
  });
});
