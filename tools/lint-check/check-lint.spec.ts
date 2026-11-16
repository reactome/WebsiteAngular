import { describe, expect, it } from 'vitest';
import { compare, countLoose, countWarnings, looseIncreases } from '../../scripts/check-lint.mjs';

// The shape of ESLint's JSON report, as much of it as the check reads.
/** A rule and its severity: 1 a warning, 2 an error. */
type Rule = [ruleId: string, severity?: number];

const report = (...rules: Rule[]) => [
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

// The services' `any` and what it lets through are counted per module apart
// (spec 013): converting a service adds thousands at once.
describe('the services\u2019 loose values', () => {
  const file = (filePath: string, ...rules: string[]) => ({
    filePath,
    messages: rules.map((ruleId) => ({ ruleId, severity: 1 })),
  });
  const unsafe = '@typescript-eslint/no-unsafe-member-access';
  const any = '@typescript-eslint/no-explicit-any';
  const sample = [
    file('/r/tools/content-node/graph.ts', unsafe, unsafe, any, 'no-console'),
    file('/r/projects/app/x.ts', unsafe),
  ];

  it('counts them per module, and keeps them out of the per-rule counts', () => {
    expect(countLoose(sample, '/r')).toEqual({ 'tools/content-node/graph.ts': 3 });
    expect(countWarnings(sample, '/r')).toEqual({ 'no-console': 1, [unsafe]: 1 });
  });

  it('fails a module whose count went up, and holds an unlisted one to none', () => {
    expect(looseIncreases({ 'tools/a.ts': 3, 'tools/b.ts': 1 }, { 'tools/a.ts': 2 })).toEqual([
      'tools/a.ts: 2 -> 3',
      'tools/b.ts: 0 -> 1',
    ]);
    expect(looseIncreases({ 'tools/a.ts': 1 }, { 'tools/a.ts': 2 })).toEqual([]);
  });
});
