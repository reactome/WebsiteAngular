import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonComponent } from '../../reactome-components/button/button.component';
import { ArticleIndexItem } from '../../../types/article';
import { ContentService } from '../../../services/content.service';
import formatDate from '../../../utils/formatDate';
import { marked } from 'marked';
import stripFirstH from '../../../utils/stripFirstH';
import truncateHtml from '../../../utils/truncateHtml';
import rewriteContentUrls from '../../../utils/rewriteContentUrls';
import { LoadErrorComponent } from '../../reactome-components/load-error/load-error.component';

@Component({
  selector: 'app-home-spotlight',
  standalone: true,
  imports: [RouterModule, ButtonComponent, LoadErrorComponent],
  templateUrl: './home-spotlight.component.html',
  styleUrl: './home-spotlight.component.scss',
})
export class HomeSpotlightComponent implements OnInit {
  contentService = inject(ContentService);

  /**
   * The newest spotlight; null while loading and when there is none. It used
   * to start as a blank placeholder dated today, so a list that failed or came
   * back empty showed that placeholder with a "Learn More" link to nothing.
   */
  readonly spotlight = signal<ArticleIndexItem | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly renderedContent = signal('');
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;

  ngOnInit() {
    this.loadSpotLightArticle();
  }

  loadSpotLightArticle() {
    this.contentService.getLatestArticles('content/reactome-research-spotlight', 1).subscribe({
      next: ([item]) => {
        this.loading.set(false);
        if (!item) return;
        this.spotlight.set({
          title: item.title,
          date: new Date(item.date),
          author: item.author,
          tags: item.tags || [],
          slug: item.slug,
          excerpt: item.excerpt,
        });

        // Load the full article content using the slug
        this.contentService.getArticle('content/reactome-research-spotlight', item.slug).subscribe({
          next: (article) => {
            // Callback kept synchronous: an async one hands a promise to code
            // that ignores it, so any rejection in here would vanish.
            void (async () => {
              const html = rewriteContentUrls(await marked(article?.body || ''));
              this.renderedContent.set(truncateHtml(stripFirstH(html), 150));
            })().catch((error) => console.error('Could not render spotlight', error));
          },
        });
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
