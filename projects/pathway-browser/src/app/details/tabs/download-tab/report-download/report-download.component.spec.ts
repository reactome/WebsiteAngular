// The words of the report's line (spec 031, contracts/report-states.md).
import { describe, expect, it } from 'vitest';
import { phaseWords, timeLeft, waitingWords } from './report-download.component';

describe("the report's line", () => {
  it('says where the report is', () => {
    expect(waitingWords({ state: 'queued', place: 1 })).toBe('Queued: next in line');
    expect(waitingWords({ state: 'queued', place: 3, estimate: 200 })).toBe(
      'Queued: number 3 in line · about 3 minutes left'
    );
    expect(waitingWords({ state: 'making', stage: 'reading' })).toBe(
      'Making your report: reading the results'
    );
    expect(
      waitingWords({ state: 'making', stage: 'figures', done: 12, total: 40, estimate: 48 })
    ).toBe('Making your report: drawing figures 12 of 40 · under a minute left');
    expect(waitingWords({ state: 'making', stage: 'printing', estimate: 0 })).toBe(
      'Making your report: printing · taking longer than expected'
    );
    // a service that says no more than that it is being made
    expect(waitingWords({ state: 'making' })).toBe('Making your report');
  });

  it('gives no estimate where there is none, never a guess', () => {
    expect(timeLeft(undefined)).toBeNull();
    expect(timeLeft(90)).toBe('about 2 minutes left');
    expect(timeLeft(60)).toBe('about 1 minute left');
  });

  it('says each failure in its own words', () => {
    expect(phaseWords({ status: 'failed', failure: 'gone' })).toContain('no longer available');
    expect(phaseWords({ status: 'failed', failure: 'busy', retryAfter: 10 })).toBe(
      'The report service is busy. Try again in 10 seconds.'
    );
    expect(phaseWords({ status: 'failed', failure: 'failed' })).toContain('could not be made');
    expect(phaseWords({ status: 'failed', failure: 'unreachable' })).toContain('two minutes');
    expect(phaseWords({ status: 'idle' })).toBeNull();
    expect(phaseWords({ status: 'saved' })).toBe('Report downloaded');
  });
});
