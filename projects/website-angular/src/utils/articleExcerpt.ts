import truncateHtml from './truncateHtml';

/** How many words of an article an excerpt keeps, in the news index and the listing. */
export const EXCERPT_WORDS = 50;

/**
 * An article's excerpt: its body's opening words, ending in "..." only when
 * the body was cut. Both the news index (scripts/generate-index.ts) and an
 * article fetched on its own (ContentService.getArticle) are given this one.
 */
export default function articleExcerpt(body: string): string {
  return truncateHtml(body, EXCERPT_WORDS);
}
