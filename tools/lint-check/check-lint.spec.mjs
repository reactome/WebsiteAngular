import { describe, expect, it } from 'vitest';
import { compare, countWarnings } from '../../scripts/check-lint.mjs';

// The shape of ESLint's JSON report, as much of it as the check reads.
const report = (...rules) => [
  { filePath: 'a.ts', messages: rules.map(([ruleId, severity = 1]) => ({ ruleId, severity })) },
];

describe('the lint ratchet', () => {
  it('counts warnings per rule, not errors', () => {
    expect(
      countWarnings(report(['no-console'], ['no-console'], ['eqeqeq', 2], ['no-var']))
    ).toEqual({
      'no-console': 2,
      'no-var': 1,
    });
  });

  // The total stayed the same, so the old check passed this.
  it('fails a rule that went up even while another came down by as much', () => {
    const result = compare({ a: 5, b: 1 }, { a: 4, b: 2 });
    expect(result.increased).toEqual([{ rule: 'a', was: 4, now: 5 }]);
  });

  it('holds a rule the baseline does not list at zero', () => {
    expect(compare({ newly: 1 }, {}).increased).toEqual([{ rule: 'newly', was: 0, now: 1 }]);
  });

  it('reports a rule that has none left, to promote', () => {
    const result = compare({ a: 3 }, { a: 3, b: 2 });
    expect(result.increased).toEqual([]);
    expect(result.cleared).toEqual(['b']);
  });

  it('passes counts that match', () => {
    expect(compare({ a: 3 }, { a: 3 })).toEqual({ increased: [], decreased: [], cleared: [] });
  });
});
