import { describe, expect, it } from 'vitest';
import { fullyStubbed, harKey, stripStubbed, stubsFile } from '../../e2e/support/har-stubs.mjs';

const entry = (url: string, status = 200, method = 'GET') => ({
  request: { method, url },
  response: { status },
});

// A test's own stubbed answers are recorded like real ones. Pooled, a made-up
// 500 became the answer other tests got for a real request (#404). Replay does
// not need them: the stub answers again.
describe('stubbed answers in a recording', () => {
  it('keys a request as replay does: method, path and query, not origin', () => {
    expect(harKey('get', 'http://localhost:4330/ContentService/data/person/69596?x=1')).toBe(
      'GET /ContentService/data/person/69596?x=1'
    );
  });

  it('names the note beside its recording', () => {
    expect(stubsFile('/r/e2e/har/person-errors--x-abc123.har')).toBe(
      '/r/e2e/har/person-errors--x-abc123.stubs'
    );
  });

  it('counts a request as stubbed only when every one of them was answered by the test', () => {
    const asked = new Map([
      ['GET /a', 2],
      ['GET /b', 2],
      ['GET /c', 1],
    ]);
    const fulfilled = new Map([
      ['GET /a', 2],
      ['GET /b', 1],
    ]);
    // /b went to the server once too: which recorded copy is the real one
    // cannot be told apart, so both stay.
    expect(fullyStubbed(asked, fulfilled)).toEqual(['GET /a']);
  });

  it('drops the stubbed answers and keeps the real ones', () => {
    const entries = [
      entry('http://localhost:4330/ContentService/data/person/69596', 500),
      entry('http://localhost:4330/ContentService/data/person/69596/authoredPathways'),
      entry('http://localhost:4330/ContentService/data/species/main'),
      entry('http://localhost:4330/ContentService/data/person/69596', 500),
    ];
    expect(stripStubbed(entries, ['GET /ContentService/data/person/69596'])).toEqual([
      entries[1],
      entries[2],
    ]);
  });

  it('keeps everything when the test stubbed nothing', () => {
    const entries = [entry('http://localhost:4330/a'), entry('http://localhost:4330/b')];
    expect(stripStubbed(entries, [])).toEqual(entries);
  });
});
