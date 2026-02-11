import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { marked } from 'marked';
import parseFrontmatter from '../utils/parseFrontmatter';
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
  private contentBasePath = '/content';

  constructor(private http: HttpClient) {}

  //Get any page by type and slug
  getPage(pageType:string, slug:string ): Observable<PageContent | null> {
    return this.http.get(`${this.contentBasePath}/${pageType}/${slug}.mdx`, { responseType: 'text' }).pipe(
      map(content => {
        const { frontmatter, body } = parseFrontmatter(content);
        return {
          title: frontmatter['title'] as string || '',
          description: frontmatter['description'] as string,
          category: frontmatter['category'] as string,
          image: frontmatter['image'] as string,
          body: body || '',
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
    return this.http.get(`${this.contentBasePath}/${path}/${slug}.mdx`, { responseType: 'text' }).pipe(
      map(content => {
        const { frontmatter, body } = parseFrontmatter(content);
        let returnArticle: Article = {
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
    return this.http.get<ArticleIndexItem[]>(`${this.contentBasePath}/${path}/index.json`).pipe(
      map(data => {
        return data || []
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
}
