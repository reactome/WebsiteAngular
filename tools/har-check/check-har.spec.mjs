import { describe, expect, it } from 'vitest';
import { problems } from '../../scripts/check-har.mjs';
import { isTruncated } from '../../e2e/support/har-entry.mjs';

const at = (path, response, method = 'GET') => ({
  request: { method, url: `http://localhost:4330${path}` },
  response,
});
const ok = (text) => ({ status: 200, headers: [], content: { text } });
const truncated = { status: 200, headers: [{ name: 'Content-Length', value: '812' }], content: {} };
const cutOff = { status: -1, headers: [], content: {} };
const har = (...entries) => ({ log: { entries } });

describe('a recorded answer cut off after its headers', () => {
  it('is refused when it is the only copy', () => {
    const result = problems(har(at('/ContentService/data/species/main', truncated)));
    expect(result.truncated).toEqual(['GET /ContentService/data/species/main']);
  });

  it('is fine beside a complete copy of the same request', () => {
    const path = '/ContentService/data/species/main';
    expect(problems(har(at(path, truncated), at(path, ok('[]')))).truncated).toEqual([]);
  });

  it('is told apart from answers that really were empty', () => {
    expect(isTruncated({ response: { status: 204, headers: [], content: {} } })).toBe(false);
    expect(
      isTruncated({
        response: { status: 200, headers: [{ name: 'content-length', value: '0' }], content: {} },
      })
    ).toBe(false);
    expect(
      isTruncated({ response: { status: 200, headers: [], content: { _file: 'a.json' } } })
    ).toBe(false);
    expect(isTruncated({ response: truncated })).toBe(true);
  });
});

describe('requests still in flight when a test ended', () => {
  it('are counted, not refused: replay aborts them, as happened', () => {
    const result = problems(har(at('/AnalysisService/token/x', cutOff)));
    expect(result).toEqual({ truncated: [], cutOff: ['GET /AnalysisService/token/x'] });
  });
});

describe('what counts as the backend', () => {
  it("leaves this site's own files and the bare API roots alone", () => {
    for (const path of ['/index.html', '/ContentService/', '/assets/x.json']) {
      expect(problems(har(at(path, truncated)))).toEqual({ truncated: [], cutOff: [] });
    }
  });
});
