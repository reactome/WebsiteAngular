export interface NewsIndexItem {
   title: string;
  author?: string;
  date: Date;

  image?: string;
  tags?: string[];

  excerpt?: string;

  slug: string;
}

export interface NewsArticle extends NewsIndexItem {
  body: string;
}