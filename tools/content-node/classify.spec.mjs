// @vitest-environment node
//
// classify.mjs, which the e2e suite uses to find the site's requests that
// are not in standard form and so never reach the edge cache.
import { describe, expect, it } from 'vitest';
import { classify } from './classify.mjs';

describe('classify', () => {
  it('finds the endpoint a request reaches, a literal route before the template', () => {
    expect(classify('GET', 'http://localhost:4330/ContentService/data/query/ids/map')).toEqual({
      endpoint: '/ContentService/data/query/ids/map',
      ok: true,
      rule: 'standard',
    });
    expect(classify('GET', '/ContentService/search/diagram/summary?query=TP53')?.endpoint).toBe(
      '/ContentService/search/diagram/summary'
    );
  });

  it('says why a request is not in standard form, a trailing slash included', () => {
    expect(classify('GET', '/ContentService/data/diseases?utm_source=x')).toEqual({
      endpoint: '/ContentService/data/diseases',
      ok: false,
      rule: 'parameter:utm_source',
    });
    expect(classify('GET', '/ContentService/data/diseases/')?.rule).toBe('form');
  });

  it('leaves out writes and what Java still answers', () => {
    expect(classify('POST', '/ContentService/data/query/ids')).toBe(undefined);
    expect(classify('GET', '/ContentService/data/query/abridged/R-HSA-1')).toBe(undefined);
    expect(classify('GET', '/ContentService/data/query/R-HSA-1/more')).toBe(undefined);
    expect(classify('GET', '/ContentService/data/query/enhanced/v2/R-HSA-1')?.endpoint).toBe(
      '/ContentService/data/query/enhanced/v2/{id}'
    );
    expect(classify('GET', '/AnalysisService/token/x')).toBe(undefined);
  });
});
