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

  it("sends ReactomeGSA's old landing page to the quantitative analysis here", () => {
    // Thirteen links in old news and spotlights point at reactome.org/gsa, a
    // separate app whose wizard this site has built in.
    const target = 'PathwayBrowser?analysisTab=quantitative';
    for (const url of [
      'https://reactome.org/gsa',
      'https://reactome.org/gsa/',
      'https://www.reactome.org/gsa/home',
      'https://reactome.org/gsa?x=1',
      'https://reactome.org/gsa#top',
      '/gsa/home',
    ]) {
      expect(rewriteContentUrls(`<a href="${url}">x</a>`)).toBe(`<a href="${target}">x</a>`);
    }
  });

  it('does not take a path that only starts with gsa for it', () => {
    expect(rewriteContentUrls('<a href="https://reactome.org/gsaX">x</a>')).toBe(
      '<a href="gsaX">x</a>'
    );
  });
});
