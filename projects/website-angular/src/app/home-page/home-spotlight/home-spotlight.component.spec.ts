import { describe, expect, it } from 'vitest';
import { SPOTLIGHT_WORDS, spotlightOpening } from './home-spotlight.component';

// The home page's spotlight opening (#951): "..." only when it was cut.
describe('spotlightOpening', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');
  const heading = '<h1>A spotlight</h1>\n';

  it('shows an opening under the word limit whole, with no "..."', () => {
    expect(spotlightOpening(`${heading}<p>${words(10)}</p>`)).toBe(`<p>${words(10)}</p>`);
  });

  it('cuts an opening over the word limit, ending it in "..."', () => {
    expect(spotlightOpening(`${heading}<p>${words(SPOTLIGHT_WORDS + 5)}</p>`)).toBe(
      `<p>${words(SPOTLIGHT_WORDS)} ...</p>`
    );
  });

  it('shows an opening of exactly the word limit whole, with no "..."', () => {
    expect(spotlightOpening(`${heading}<p>${words(SPOTLIGHT_WORDS)}</p>`)).toBe(
      `<p>${words(SPOTLIGHT_WORDS)}</p>`
    );
  });

  it('shows an opening under the word limit whole however long its tags are', () => {
    const html = `<p><a href="/a/long/path" title="${words(SPOTLIGHT_WORDS)}">${words(10)}</a></p>`;
    expect(spotlightOpening(`${heading}${html}`)).toBe(html);
  });
});
