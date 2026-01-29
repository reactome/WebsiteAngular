// import { Injectable, inject, PLATFORM_ID } from '@angular/core';
// import { isPlatformBrowser } from '@angular/common';
// import { HttpClient } from '@angular/common/http';
// import { Observable, map, catchError, of, timeout } from 'rxjs';
// import { environment } from '../../environments/environment';

// export interface Article {
//   slug: string;
//   title: string;
//   date: string;
//   excerpt: string | null;
//   featuredImage: string | null;
//   tags: string[] | null;
// }

// interface ArticleIndexItem {
//   slug: string;
//   title: string;
//   date: string;
//   excerpt?: string;
//   featuredImage?: string;
//   tags?: string[];
// }

// interface NewsIndex {
//   articles: ArticleIndexItem[];
// }

// interface NewsNode {
//   _sys: {
//     filename: string;
//   };
//   title: string;
//   date: string;
//   excerpt: string | null;
//   featuredImage: string | null;
//   tags: (string | null)[] | null;
// }

// interface NewsConnectionResponse {
//   data: {
//     newsConnection: {
//       totalCount: number;
//       pageInfo: {
//         hasNextPage: boolean;
//         endCursor: string;
//       };
//       edges: Array<{
//         node: NewsNode;
//       } | null> | null;
//     };
//   };
//   errors?: Array<{ message: string }>;
// }

// @Injectable({
//   providedIn: 'root'
// })
// export class TinaService {
//   private http = inject(HttpClient);
//   private platformId = inject(PLATFORM_ID);
//   private graphqlUrl = environment.tinaGraphqlUrl;
//   private isBrowser = isPlatformBrowser(this.platformId);

//   /**
//    * Get the latest news articles, sorted by date descending
//    * Falls back to index.json if TinaCMS is unavailable or during SSR
//    * @param first Number of articles to fetch
//    * @returns Observable of Article array
//    */
//   getLatestNews(first: number = 5): Observable<Article[]> {
//     // During SSR, skip TinaCMS and use fallback directly
//     if (!this.isBrowser) {
//       return this.getNewsFromIndex(first);
//     }

//     const query = `
//       query GetLatestNews($first: Float, $sort: String) {
//         newsConnection(first: $first, sort: $sort) {
//           totalCount
//           pageInfo {
//             hasNextPage
//             endCursor
//           }
//           edges {
//             node {
//               _sys {
//                 filename
//               }
//               title
//               date
//               excerpt
//               featuredImage
//               tags
//             }
//           }
//         }
//       }
//     `;

//     const variables = {
//       first,
//       sort: 'date'  // TinaCMS sorts descending by default for datetime fields
//     };

//     return this.http.post<NewsConnectionResponse>(this.graphqlUrl, {
//       query,
//       variables
//     }).pipe(
//       timeout(3000), // 3 second timeout for TinaCMS
//       map(response => {
//         if (response.errors) {
//           console.error('TinaCMS GraphQL errors:', response.errors);
//           throw new Error('GraphQL errors');
//         }

//         const edges = response.data?.newsConnection?.edges || [];

//         // Map and sort by date descending (newest first)
//         const articles = edges
//           .filter((edge): edge is { node: NewsNode } => edge?.node != null)
//           .map(edge => ({
//             slug: edge.node._sys.filename,
//             title: edge.node.title,
//             date: edge.node.date,
//             excerpt: edge.node.excerpt,
//             featuredImage: edge.node.featuredImage,
//             tags: edge.node.tags?.filter((t): t is string => t != null) || null
//           }))
//           .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

//         return articles;
//       }),
//       catchError(error => {
//         console.warn('TinaCMS unavailable, falling back to index.json:', error.message);
//         return this.getNewsFromIndex(first);
//       })
//     );
//   }

//   /**
//    * Fallback: Load news from index.json when TinaCMS is unavailable
//    */
//   private getNewsFromIndex(first?: number): Observable<Article[]> {
//     return this.http.get<NewsIndex>('/content/news/index.json').pipe(
//       map(data => {
//         const articles = data.articles
//           .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
//           .map(item => ({
//             slug: item.slug,
//             title: item.title,
//             date: item.date,
//             excerpt: item.excerpt || null,
//             featuredImage: item.featuredImage || null,
//             tags: item.tags || null
//           }));
//         return first ? articles.slice(0, first) : articles;
//       }),
//       catchError(error => {
//         console.error('Error loading news from index.json:', error);
//         return of([]);
//       })
//     );
//   }

//   /**
//    * Get all news articles for the news listing page
//    * Falls back to index.json if TinaCMS is unavailable or during SSR
//    * @param after Cursor for pagination
//    * @param first Number of articles per page
//    * @returns Observable with articles and pagination info
//    */
//   getAllNews(first: number = 20, after?: string): Observable<{
//     articles: Article[];
//     totalCount: number;
//     hasNextPage: boolean;
//     endCursor: string;
//   }> {
//     // During SSR, skip TinaCMS and use fallback directly
//     if (!this.isBrowser) {
//       return this.getNewsFromIndex().pipe(
//         map(articles => ({
//           articles,
//           totalCount: articles.length,
//           hasNextPage: false,
//           endCursor: ''
//         }))
//       );
//     }

//     const query = `
//       query GetAllNews($first: Float, $after: String, $sort: String) {
//         newsConnection(first: $first, after: $after, sort: $sort) {
//           totalCount
//           pageInfo {
//             hasNextPage
//             endCursor
//           }
//           edges {
//             node {
//               _sys {
//                 filename
//               }
//               title
//               date
//               excerpt
//               featuredImage
//               tags
//             }
//           }
//         }
//       }
//     `;

//     const variables: { first: number; sort: string; after?: string } = {
//       first,
//       sort: 'date'
//     };

//     if (after) {
//       variables.after = after;
//     }

//     return this.http.post<NewsConnectionResponse>(this.graphqlUrl, {
//       query,
//       variables
//     }).pipe(
//       timeout(3000), // 3 second timeout for TinaCMS
//       map(response => {
//         if (response.errors) {
//           console.error('TinaCMS GraphQL errors:', response.errors);
//           throw new Error('GraphQL errors');
//         }

//         const connection = response.data?.newsConnection;
//         const edges = connection?.edges || [];

//         const articles = edges
//           .filter((edge): edge is { node: NewsNode } => edge?.node != null)
//           .map(edge => ({
//             slug: edge.node._sys.filename,
//             title: edge.node.title,
//             date: edge.node.date,
//             excerpt: edge.node.excerpt,
//             featuredImage: edge.node.featuredImage,
//             tags: edge.node.tags?.filter((t): t is string => t != null) || null
//           }))
//           .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

//         return {
//           articles,
//           totalCount: connection?.totalCount || 0,
//           hasNextPage: connection?.pageInfo?.hasNextPage || false,
//           endCursor: connection?.pageInfo?.endCursor || ''
//         };
//       }),
//       catchError(error => {
//         console.warn('TinaCMS unavailable, falling back to index.json:', error.message);
//         return this.getNewsFromIndex().pipe(
//           map(articles => ({
//             articles,
//             totalCount: articles.length,
//             hasNextPage: false,
//             endCursor: ''
//           }))
//         );
//       })
//     );
//   }
// }
//TODO: Delete if unused