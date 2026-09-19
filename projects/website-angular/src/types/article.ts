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
