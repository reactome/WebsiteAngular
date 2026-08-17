
import { Injectable, DOCUMENT, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { Article, ArticleIndexItem } from '../types/article';
import truncateHtml from '../utils/truncateHtml';

export interface PageContent {
  title: string;
  description?: string;
  category?: string;
  image?: string;
  body: string;
}

export interface TeamMember {
  name: string;
  role: string;
  institution: string;
  type: 'principal_investigator' | 'current' | 'alumni';
}

@Injectable({
  providedIn: 'root'
})

export class ContentService {
  private http = inject(HttpClient);
  private document = inject<Document>(DOCUMENT);

  private readonly contentBasePath: string;

  constructor() {
    this.contentBasePath = new URL('content/', this.document.baseURI).toString().replace(/\/$/, '');
  }

  //Get any page by type and slug
  getPage(pageType:string, slug:string ): Observable<PageContent | null> {
    // Content is authored as .mdx and compiled to JSON at build time by
    // scripts/stage-content.ts. Frontmatter is already parsed server-side, so
    // the browser just consumes structured data -- no raw markdown fetch, and
    // nothing for vite to mistake for JSX source.
    return this.http.get<Record<string, unknown>>(`${this.contentBasePath}/${pageType}/${slug}.json`).pipe(
      map(frontmatter => {
        return {
          title: frontmatter['title'] as string || '',
          description: frontmatter['description'] as string,
          category: frontmatter['category'] as string,
          image: frontmatter['image'] as string,
          body: frontmatter['body'] as string || '',
        };
      })
    )
  }

  /**
   * Get article index item by slug
   */
  getArticleIndexItem(path:string, slug: string): Observable<ArticleIndexItem | null> {
    return this.http.get<ArticleIndexItem[]>(`${this.contentBasePath}/${path}/index.json`).pipe(
      map(items => {
        const item = items.find(i => i.slug === slug);
        return item || null;
      })
    )
  }


  /**
   * Get an article by slug
   */
  getArticle(path:string, slug: string): Observable<Article | null> {
    // See getPage(): content is compiled to JSON at build time.
    return this.http.get<Record<string, unknown>>(`${this.contentBasePath}/${path}/${slug}.json`).pipe(
      map(frontmatter => {
        const body = frontmatter['body'] as string;
        const returnArticle: Article = {
          title: frontmatter['title'] as string || '',
          date: new Date(frontmatter['date'] as string),
          author: frontmatter['author'] as string,
          image: frontmatter['image'] as string,
          tags: typeof frontmatter['tags'] === 'string' ? frontmatter['tags'].split(',').map((t: string) => t.trim().replace(/^[\[\["']+|[\]'"]+$/g, '')) : frontmatter['tags'] as string[] | undefined,
          body: body || '',
          excerpt: truncateHtml(body || '', 50),
          slug: slug
        };
        return returnArticle;
      }),
      catchError(() => of(null))
    );
  }

  /**
   * Get all articles
   */
  getAllArticles(path:string): Observable<ArticleIndexItem[]> {
    return this.http.get<any>(`${this.contentBasePath}/${path}/index.json`).pipe(
      map(data => {
        if (Array.isArray(data)) return data;
        if (data?.articles && Array.isArray(data.articles)) return data.articles;
        return [];
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Get latest articles (for home page)
   */
  getLatestArticles(path:string, count: number = 3): Observable<ArticleIndexItem[]> {
    return this.getAllArticles(path).pipe(
      map(articles => {
        return articles.slice(0, count);
      })
    );
  }

  /**
   * Get all team members
   */
  getTeamMembers(): Observable<TeamMember[]> {
    return this.http.get<TeamMember[]>(`${this.contentBasePath}/team/index.json`).pipe(
      catchError(() => of([]))
    );
  }

  /**
   * Get team member by slug
   */
  getTeamMember(slug: string): Observable<TeamMember | null> {
    return this.http.get<TeamMember>(`${this.contentBasePath}/team/${slug}.json`).pipe(
      catchError(() => of(null))
    );
  }


  /**
   * Get all FAQ categories
   */
  getFaqIndex(): Observable<Record<string, ArticleIndexItem[]>> {
    return this.http.get<Record<string, ArticleIndexItem[]>>(`${this.contentBasePath}/documentation/faq/index.json`).pipe(
      catchError(() => of({}))
    );
  }

  getFaqArticle(category: string, slug: string): Observable<Article | null> {
    // See getPage(): content is compiled to JSON at build time.
    return this.http.get<Record<string, unknown>>(`${this.contentBasePath}/documentation/faq/${category}/${slug}.json`).pipe(
      map(frontmatter => {
        const body = frontmatter['body'] as string;
        const returnArticle: Article = {
          title: frontmatter['title'] as string || '',
          date: new Date(frontmatter['date'] as string),
          author: frontmatter['author'] as string,
          image: frontmatter['image'] as string,
          tags: typeof frontmatter['tags'] === 'string' ? frontmatter['tags'].split(',').map((t: string) => t.trim().replace(/^[\[\["']+|[\]'"]+$/g, '')) : frontmatter['tags'] as string[] | undefined,
          body: body || '',
          excerpt: truncateHtml(body || '', 50),
          slug: slug
        };
        return returnArticle;
      }),
      catchError(() => of(null))
    );
  }
}
