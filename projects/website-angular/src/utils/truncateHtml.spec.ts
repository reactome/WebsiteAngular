import { describe, expect, it } from 'vitest';
import truncateHtml from './truncateHtml';

describe('truncateHtml', () => {
  it('closes the HTML tags it cut through', () => {
    expect(truncateHtml('<p>one <em>two three</em> four</p>', 2)).toBe(
      '<p>one <em>two ...</em></p>'
    );
  });

  it('takes a markdown link written in angle brackets for a link, not for a tag to close', () => {
    // As the V98 announcement opens: its figure's address in angle brackets.
    const body =
      '![A figure](<https://download.reactome.org/98/ehld/R-HSA-9820460.svg>)\n\n' +
      '[A pathway](</PathwayBrowser/#9820460>) and several more words after it';
    const excerpt = truncateHtml(body, 6);
    expect(excerpt).not.toContain('</https');
    expect(excerpt.endsWith('...')).toBe(true);
  });

  // #951: "..." says words were left out, so it is there only when they were.
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');

  it('adds no "..." to text under the word limit', () => {
    expect(truncateHtml(words(3), 5)).toBe(words(3));
    expect(truncateHtml(`<p>${words(3)}</p>`, 5)).toBe(`<p>${words(3)}</p>`);
  });

  it('ends text over the word limit in "..."', () => {
    expect(truncateHtml(words(8), 5)).toBe(`${words(5)} ...`);
    // One word over, the text ending on it
    expect(truncateHtml(words(6), 5)).toBe(`${words(5)} ...`);
    expect(truncateHtml(`<p>${words(8)}</p>`, 5)).toBe(`<p>${words(5)} ...</p>`);
  });

  it('adds no "..." to text of exactly the word limit, however it ends', () => {
    expect(truncateHtml(words(5), 5)).toBe(words(5));
    expect(truncateHtml(`${words(5)}\n`, 5)).toBe(`${words(5)}\n`);
    expect(truncateHtml(`<p>${words(5)}</p>`, 5)).toBe(`<p>${words(5)}</p>`);
  });

  it('counts the words of the text, not of its tags', () => {
    // A tag with more words in it than the limit, around text under it
    const html = `<p><a href="/a/long/path" title="${words(20)}">${words(3)}</a></p>`;
    expect(truncateHtml(html, 5)).toBe(html);
  });
});
