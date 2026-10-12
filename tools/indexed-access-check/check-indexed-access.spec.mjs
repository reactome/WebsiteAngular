import { describe, expect, it } from 'vitest';
import { countErrors, outcome } from '../../scripts/check-indexed-access.mjs';

// tsc's own output, as `tsc --noEmit` prints it without --pretty.
const output = [
  "projects/a/src/x.ts(10,5): error TS2532: Object is possibly 'undefined'.",
  "projects/a/src/x.ts(12,9): error TS18048: 'row' is possibly 'undefined'.",
  "projects/b/src/y.ts(3,1): error TS2345: Argument of type 'string | undefined' is not assignable.",
  "  Type 'undefined' is not assignable to type 'string'.",
].join('\n');

describe('the indexed-access count', () => {
  it('counts errors per file, ignoring continuation lines', () => {
    expect(countErrors(output)).toEqual({ 'projects/a/src/x.ts': 2, 'projects/b/src/y.ts': 1 });
  });

  it('reads a clean run as no errors', () => {
    expect(outcome(0, '')).toEqual({ ok: true, counts: {} });
  });

  it('reads errors from a run that failed on them', () => {
    expect(outcome(2, output)).toEqual({ ok: true, counts: countErrors(output) });
  });

  // A crash prints no error lines, which would otherwise read as a clean run
  // (scripts/check-types.mjs says how that cost an afternoon).
  it('refuses a run that failed without reporting an error', () => {
    expect(outcome(134, 'FATAL ERROR: JavaScript heap out of memory').ok).toBe(false);
    expect(outcome(2, 'error TS5058: The specified path does not exist').ok).toBe(false);
  });
});
