export interface ArticleIndexItem {
  title: string;
  author?: string;
  date: Date;

  image?: string;
  tags?: string[];

  excerpt?: string;

  slug: string;
}

export interface Article extends ArticleIndexItem {
  /**
   * Every image this article shows, and the space it needs, measured when the
   * content was staged. Optional: an article without images has none.
   */
  imageSizes?: Record<string, [number, number]>;
  body: string;
}

/** A group of FAQ questions: a category's own, or one of its tabs. */
export interface FaqGroup {
  articles?: ArticleIndexItem[];
}

/**
 * The FAQ index, as `documentation/faq/index.json` is generated: categories,
 * each holding its questions directly or tabs (sub-categories) of them.
 */
export type FaqIndex = Record<string, FaqGroup & Record<string, FaqGroup | ArticleIndexItem[]>>;
