import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { TileComponent } from '../../reactome-components/tile/tile.component';
import { ContentService } from '../../../services/content.service';
import { ArticleIndexItem } from '../../../types/article';
import formatDate from '../../../utils/formatDate';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import stripFirstH from '../../../utils/stripFirstH';
import { marked } from 'marked';

@Component({
  selector: 'app-article-page',
  imports: [PageLayoutComponent, TileComponent, MatIcon, RouterLink],
  templateUrl: './article-page.component.html',
  styleUrl: './article-page.component.scss',
})
export class ArticlePageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private contentService = inject(ContentService);
  // Plain fields assigned from an async callback: the app is zoneless, so
  // nothing notices them changing without being told.
  private cdr = inject(ChangeDetectorRef);

  pageTile: string = 'News & Updates';
  pageDescription: string =
    'Stay up to date with the latest Reactome releases, publications, and announcements.';
  articlePath: string = 'about/news';

  articles: ArticleIndexItem[] = [];
  loading = true;

  // Build the routerLink commands for a given article. Passing a single
  // string containing slashes (e.g. 'about/news') as one routerLink segment
  // makes Angular URL-encode the slash (-> /about%2Fnews/...), producing a
  // broken route. Splitting into separate segments routes correctly.
  articleLink(slug: string): string[] {
    return ['/', ...this.articlePath.split('/').filter(Boolean), slug];
  }

  ngOnInit() {
    this.route.url.subscribe((segments) => {
      // Build the path from URL segments (e.g., about/userguide/pathway-browser)
      const path_segments = segments.map((s) => s.path);

      if (path_segments.length > 0 && path_segments) {
        if (path_segments.includes('about')) {
          this.loadArticles('about/news');
          this.pageTile = 'News & Updates';
          this.pageDescription =
            'Stay up to date with the latest Reactome releases, publications, and announcements.';
          this.articlePath = 'about/news';
        } else if (path_segments.includes('content')) {
          this.loadArticles('content/reactome-research-spotlight');
          this.pageTile = 'Reactome Research Spotlights';
          this.pageDescription = 'Explore the latest research spotlights from Reactome.';
          this.articlePath = 'content/reactome-research-spotlight';
        }
      }
      this.cdr.markForCheck();
    });
  }

  private loadArticles(path: string) {
    this.loading = true;
    // Fetch all articles from TinaCMS GraphQL API
    this.contentService.getAllArticles(path).subscribe({
      next: (result) => {
        // Callback kept synchronous: an async one hands a promise to code
        // that ignores it, so any rejection in here would vanish.
        void (async () => {
          this.articles = result.map((item: ArticleIndexItem) => ({
            title: item.title,
            date: new Date(item.date),
            author: item.author,
            tags: item.tags || [],
            slug: item.slug,
            excerpt: item.excerpt,
          }));

          // Awaited as a batch: previously these were started and abandoned,
          // so loading flipped to false while the excerpts were still raw
          // markdown, and any failure went unreported.
          await Promise.all(
            this.articles.map(async (article) => {
              const html = await marked(article?.excerpt || '');
              article.excerpt = stripFirstH(html);
            })
          );
          this.loading = false;
        })().catch((error) => console.error('Could not render article list', error));
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.articles = [];
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
