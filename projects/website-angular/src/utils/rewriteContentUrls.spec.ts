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

  it('leaves a link to a page this site does not serve yet on production', () => {
    // Nine old news items link reactome.org/gsa, which works there and would
    // be a missing page here.
    const html = '<a href="https://reactome.org/gsa">GSA</a>';
    expect(rewriteContentUrls(html)).toBe(html);
  });

  it('keeps such a link on production with a query or fragment too', () => {
    for (const url of ['https://reactome.org/gsa?x=1', 'https://reactome.org/gsa#top']) {
      expect(rewriteContentUrls(`<a href="${url}">x</a>`)).toBe(`<a href="${url}">x</a>`);
    }
  });
});
