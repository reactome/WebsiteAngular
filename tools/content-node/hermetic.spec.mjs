// @vitest-environment node
//
// The unit specs never reach the graph. graph.mjs reads credentials from a
// file when the environment has none, so on a machine that has one every spec
// run would query a real graph, and the specs written for the graph being
// unreachable would never exercise that path there. vitest.config.ts points
// the file at nothing; this holds it.
import { describe, expect, it } from 'vitest';
import { configured } from './graph.ts';

describe('the unit specs', () => {
  it('have no graph credentials, wherever they run', () => {
    expect(configured()).toBe(false);
  });
});
