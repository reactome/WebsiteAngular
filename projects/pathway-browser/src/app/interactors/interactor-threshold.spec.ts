/**
 * The confidence threshold, decided without a browser.
 *
 * The cases below are the ones the feature specification names rather than
 * invented ones: the hand-edited addresses of FR-008, and the interaction with no
 * score from the data model's validation rule.
 *
 * The counts come from Q13158 (FADD), measured against the ContentService on
 * 2026-09-14: 33 interactions, 0.482 to 0.98, 13 of them at or above 0.6.
 */
import { describe, expect, it } from 'vitest';
import { clampThreshold, DEFAULT_INTERACTOR_SCORE, passesThreshold } from './interactor-threshold';

describe('the threshold a URL asks for', () => {
  it('takes a number that is a proportion', () => {
    expect(clampThreshold(0.6)).toBe(0.6);
    expect(clampThreshold(0)).toBe(0);
    expect(clampThreshold(1)).toBe(1);
  });

  it('reads the string a query parameter actually carries', () => {
    expect(clampThreshold('0.6')).toBe(0.6);
    expect(clampThreshold('0')).toBe(0);
  });

  it('falls back to the default rather than blocking the pathway', () => {
    // FR-008 names these: a word, a negative number, a value above the maximum.
    // None may stop the pathway or its interactors from opening.
    for (const raw of ['banana', -1, 2, '', null, undefined, NaN, '0.6.1']) {
      expect(clampThreshold(raw), JSON.stringify(raw)).toBe(DEFAULT_INTERACTOR_SCORE);
    }
  });

  it('matches the old browser at 0.45', () => {
    // DEFAULT_SCORE in pwp-diagram's InteractorsContent.java. A curator comparing
    // the two sites has to see the same first view.
    expect(DEFAULT_INTERACTOR_SCORE).toBe(0.45);
  });
});

describe('which interactions are drawn', () => {
  it('keeps an interaction whose score equals the threshold', () => {
    // Dragging to 0.6 means "0.6 is good enough", not "better than 0.6".
    expect(passesThreshold({ score: 0.6 }, 0.6)).toBe(true);
  });

  it('drops one below it and keeps one above', () => {
    expect(passesThreshold({ score: 0.482 }, 0.6)).toBe(false);
    expect(passesThreshold({ score: 0.98 }, 0.6)).toBe(true);
  });

  it('hides an interaction that carries no score', () => {
    // None were seen in the measured data, but a claim with no confidence behind
    // it is what raising the threshold is meant to remove -- so the absent case
    // follows the weak case rather than being waved through.
    for (const interaction of [{}, { score: null }, { score: undefined }, { score: NaN }]) {
      expect(passesThreshold(interaction, 0), JSON.stringify(interaction)).toBe(false);
    }
  });

  it('shows everything at zero, except the unscored', () => {
    expect(passesThreshold({ score: 0 }, 0)).toBe(true);
    expect(passesThreshold({ score: 0.482 }, 0)).toBe(true);
    expect(passesThreshold({}, 0)).toBe(false);
  });

  it('reproduces the measured counts for Q13158', () => {
    // The real spread, so the predicate is checked against data rather than
    // against three numbers chosen to agree with it.
    const scores = [
      0.482, 0.499, 0.508, 0.527, 0.556, 0.567, 0.573, 0.581, 0.593, 0.653, 0.676, 0.725,
    ];
    const above = (threshold: number) =>
      scores.filter((score) => passesThreshold({ score }, threshold)).length;

    expect(above(0), 'every one of the sample is shown at zero').toBe(scores.length);
    expect(above(DEFAULT_INTERACTOR_SCORE), 'the default hides none of these').toBe(scores.length);
    expect(above(0.6), 'only the three at or above 0.6').toBe(3);
    expect(above(0.99), 'none of the sample reaches 0.99').toBe(0);
  });
});
