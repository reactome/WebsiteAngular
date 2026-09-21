import { describe, expect, it } from 'vitest';
import { provenance, waitingMessage } from './panel-copy';

describe('what the wait says', () => {
  it('claims nothing about the result before the service has said anything', () => {
    expect(waitingMessage(false)).toBe('Reading your analysis result.');
  });

  it('changes when the start event lands, which is the one real milestone', () => {
    expect(waitingMessage(true)).toBe('Writing the summary…');
  });

  it('never reports a source count, which this stream does not have before prose', () => {
    // The answer panel says "found N sources" because its citations are gated
    // on retrieval finishing. Here they arrive with the prose, so borrowing
    // that line would be reporting a milestone that has not happened.
    expect(`${waitingMessage(true)} ${waitingMessage(false)}`).not.toMatch(/source/i);
  });
});

describe('what the panel says the summary was made from', () => {
  it('says identifiers were sent only when they actually were', () => {
    expect(provenance('identifiers')).toContain('could not match');
  });

  it('says they were not, for an aggregate summary', () => {
    expect(provenance('aggregate')).toContain('not your identifiers');
  });

  it('does not claim identifiers were sent when nothing has said so', () => {
    // The requested tier is not the applied one: asking to disclose and having
    // the lookup fail gives the aggregate summary. Erring towards "we sent
    // them" would tell a reader their identifiers left the browser when they
    // did not, which is the worse of the two mistakes.
    expect(provenance(null)).toContain('not your identifiers');
  });
});
