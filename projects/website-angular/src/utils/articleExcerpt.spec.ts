import { describe, expect, it } from 'vitest';
import articleExcerpt, { EXCERPT_WORDS } from './articleExcerpt';

// The excerpts of the news index and listing (#951): "..." only when cut.
describe('articleExcerpt', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');

  it('keeps a body under the word limit whole, with no "..."', () => {
    expect(articleExcerpt(`## A title\n\n${words(10)}\n`)).toBe(`## A title\n\n${words(10)}\n`);
  });

  it('cuts a body over the word limit, ending it in "..."', () => {
    // The heading's three words count: "##", "A", "title"
    expect(articleExcerpt(`## A title\n\n${words(EXCERPT_WORDS)}`)).toBe(
      `## A title\n\n${words(EXCERPT_WORDS - 3)} ...`
    );
  });

  it('keeps a body of exactly the word limit whole, with no "..."', () => {
    expect(articleExcerpt(words(EXCERPT_WORDS))).toBe(words(EXCERPT_WORDS));
  });

  it('keeps a body under the word limit whole however long its tags are', () => {
    const body = `<p><img src="/a/long/path.png" alt="${words(EXCERPT_WORDS)}"> ${words(10)}</p>`;
    expect(articleExcerpt(body)).toBe(body);
  });
});
