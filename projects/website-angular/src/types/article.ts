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
  body: string;
}
