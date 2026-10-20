// @vitest-environment node
//
// classify.ts, which the e2e suite uses to find the site's requests that
// are not in standard form and so never reach the edge cache.
import { describe, expect, it } from 'vitest';
import { classify } from './classify.ts';

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

  it("leaves out every form nginx keeps on Java's /query, not node's own", () => {
    for (const path of [
      '/ContentService/data/query/abridged/R-HSA-1',
      '/ContentService/data/query/abridged/stId',
      '/ContentService/data/query/abridged/R-HSA-1/stId',
      '/ContentService/data/query/enhanced/R-HSA-1/stId',
      '/ContentService/data/query/R-HSA-1/more/',
    ])
      expect([path, classify('GET', path)]).toEqual([path, undefined]);
    expect(classify('GET', '/ContentService/data/query/enhanced/R-HSA-1')?.endpoint).toBe(
      '/ContentService/data/query/enhanced/{id}'
    );
  });

  it('counts a HEAD as its GET', () => {
    expect(classify('HEAD', '/ContentService/data/diseases')?.rule).toBe('standard');
  });

  it('reports a run: distinct requests, how many are standard, the rest by rule', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'classify-'));
    try {
      const file = join(dir, 'audit.jsonl');
      const line = (url, method = 'GET') => JSON.stringify({ test: 't', method, url });
      writeFileSync(
        file,
        [
          line('http://x/ContentService/data/diseases'),
          line('http://x/ContentService/data/diseases'),
          line('http://x/ContentService/data/diseases?utm_source=y'),
          line('http://x/ContentService/data/query/ids', 'POST'),
        ].join('\n') + '\n'
      );
      const out = execFileSync(
        process.execPath,
        [new URL('./classify.ts', import.meta.url).pathname, file],
        {
          encoding: 'utf8',
        }
      );
      expect(out).toContain('2 distinct node requests, 1 in standard form');
      expect(out).toContain('parameter:utm_source: 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
