import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';
import { marked } from 'marked';
import e from 'express';
import parseFrontmatter from '../utils/parseFrontmatter';
import { Article, ArticleIndexItem } from '../types/article';

export interface PageContent {
  title: string;
  description?: string;
  category?: string;
  image?: string;
  body: string;
  // bodyHtml?: string;
}



export interface TeamMember {
  name: string;
  role: string;
  institution: string;
  type: 'principal_investigator' | 'current' | 'alumni';
}

// export interface FaqItem {
//   question: string;
//   category: string;
//   order?: number;
//   answer: string;
// }

// export interface SpotlightArticle {
//   title: string;
//   date: Date;
//   journal?: string;
//   authors?: string;
//   excerpt?: string;
//   pathways?: string[];
//   articleUrl?: string;
//   body: string;
//   slug: string;
// }

// export interface SiteSettings {
//   siteTitle: string;
//   tagline: string;
//   stats: {
//     version: string;
//     releaseDate: string;
//     humanPathways: number;
//     reactions: number;
//     proteins: number;
//     smallMolecules: number;
//     drugs: number;
//     references: number;
//   };
//   contact: {
//     email: string;
//     twitter: string;
//     github: string;
//   };
// }

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
          body: frontmatter['body'] as string || body,
          bodyHtml: undefined // Will be processed by component
        };
      })
    )
  }

  /**
   * Convert markdown to HTML
   */
  private async markdownToHtml(markdown: string): Promise<string> {
    return await marked(markdown);
  }

  // /**
  //  * Get all pages
  //  */
  // getAllPages(): Observable<PageContent[]> {
  //   // In a real app, this would call an API or use a manifest file
  //   const slugs = ['what-is-reactome', 'license', 'privacy'];
  //   return this.http.get<PageContent[]>(`${this.contentBasePath}/pages/index.json`).pipe(
  //     catchError(() => {
  //       // Fallback to known pages
  //       return of(slugs.map(slug => ({ title: slug, body: '', slug })) as unknown as PageContent[]);
  //     })
  //   );
  // }

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
          tags: frontmatter['tags'] as string[],
          body: frontmatter['body'] as string || body, //TODO: links and formatting in body
          excerpt: frontmatter['body']?.toString().substring(0, 200) || '',
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
        console.log("All articles fetched for latest:", articles[0].slug);
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
   * Get all FAQ items
   */
  // getFaqItems(): Observable<FaqItem[]> {
  //   return this.http.get<FaqItem[]>(`${this.contentBasePath}/faq/index.json`).pipe(
  //     catchError(() => of([]))
  //   );
  // }

  /**
   * Get FAQ items by category
   */
  // getFaqByCategory(category: string): Observable<FaqItem[]> {
  //   return this.getFaqItems().pipe(
  //     map(items => items.filter(item => item.category === category))
  //   );
  // }

  // /**
  //  * Get site settings
  //  */
  // getSiteSettings(): Observable<SiteSettings | null> {
  //   return this.http.get<SiteSettings>(`${this.contentBasePath}/settings/global.json`).pipe(
  //     catchError(() => of(null))
  //   );
  // }
}
