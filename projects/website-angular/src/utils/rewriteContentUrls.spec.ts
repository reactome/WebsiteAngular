import { describe, expect, it } from 'vitest';
import rewriteContentUrls from './rewriteContentUrls';

describe('rewriteContentUrls', () => {
  it('brings reactome.org links home', () => {
    expect(rewriteContentUrls('<a href="https://reactome.org/userguide/analysis">x</a>')).toBe(
      '<a href="userguide/analysis">x</a>'
    );
    // Not an empty href, which would mean the page the reader is already on.
    expect(rewriteContentUrls('<a href="https://www.reactome.org/">x</a>')).toBe(
      '<a href="/">x</a>'
    );
  });

  it('makes root paths relative to the base href', () => {
    expect(rewriteContentUrls('<img src="/uploads/a.png">')).toBe('<img src="uploads/a.png">');
  });

  it('leaves other hosts alone, including the download bucket', () => {
    const html =
      '<a href="https://download.reactome.org/97/x.tgz">x</a><a href="https://example.org/">y</a>';
    expect(rewriteContentUrls(html)).toBe(html);
  });
});
