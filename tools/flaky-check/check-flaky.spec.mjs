import { describe, expect, it } from 'vitest';
import { summarise } from '../../scripts/check-flaky.mjs';

// The shape of Playwright's JSON report, as much of it as the check reads.
const report = (...tests) => ({
  suites: [
    {
      file: 'downloads.spec.ts',
      specs: tests.map(([title, status, reason]) => ({
        title,
        file: 'downloads.spec.ts',
        tests: [{ status, annotations: reason ? [{ type: 'skip', description: reason }] : [] }],
      })),
    },
  ],
});

describe('skipped tests', () => {
  const expected = { 'downloads.spec.ts › a diagram GIF': 'needs the render service' };

  it('lets an expected skip through, with its reason', () => {
    const result = summarise(report(['a diagram GIF', 'skipped', 'render service down']), expected);
    expect(result.unexpected).toEqual([]);
    expect(result.skipped).toEqual([
      { name: 'downloads.spec.ts › a diagram GIF', reason: 'render service down' },
    ]);
  });

  it('catches a test that starts skipping', () => {
    // The case this exists for: a probe answered wrongly, or the thing the test
    // checks went missing, and the test reported green while checking nothing.
    const result = summarise(report(['a PNG tier', 'skipped', 'backend not answering']), expected);
    expect(result.unexpected.map((t) => t.name)).toEqual(['downloads.spec.ts › a PNG tier']);
  });

  it('says so when a skip gives no reason', () => {
    const result = summarise(report(['a PNG tier', 'skipped', '']), expected);
    expect(result.unexpected[0].reason).toBe('(no reason given)');
  });

  it('still counts flaky tests, and ignores ones that passed', () => {
    const result = summarise(report(['a', 'flaky'], ['b', 'expected']), expected);
    expect(result.flaky).toEqual(['downloads.spec.ts › a']);
    expect(result.skipped).toEqual([]);
  });
});

describe('tests a failure stopped', () => {
  it('are not refused as skips when an earlier test in the file failed', () => {
    const result = summarise(report(['first', 'unexpected'], ['second', 'skipped', '']), {});
    expect(result.unexpected).toEqual([]);
    expect(result.skipped[0].reason).toBe('not run: an earlier test in its file failed');
  });

  it('still refuse an unexplained skip in a file where nothing failed', () => {
    expect(summarise(report(['second', 'skipped', '']), {}).unexpected).toHaveLength(1);
  });
});
