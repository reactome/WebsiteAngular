import { ArticleIndexItem } from '../types/article';

/**
 * An index entry ready to list: its date parsed and its tags never missing.
 * What the index left out stays out, rather than becoming a key set to
 * undefined.
 */
export function articleIndexItem(item: ArticleIndexItem): ArticleIndexItem {
  const { title, author, date, tags, excerpt, slug } = item;
  return {
    title,
    date: new Date(date),
    tags: tags ?? [],
    slug,
    ...(author !== undefined && { author }),
    ...(excerpt !== undefined && { excerpt }),
  };
}
