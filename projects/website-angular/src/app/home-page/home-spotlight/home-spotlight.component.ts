import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject, Input, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonComponent } from '../../reactome-components/button/button.component';
import { ArticleIndexItem } from '../../../types/article';
import { ContentService } from '../../../services/content.service';
import formatDate from '../../../utils/formatDate';
import { marked } from 'marked';
import stripFirstH from '../../../utils/stripFirstH';
import truncateHtml from '../../../utils/truncateHtml';
import { NavOption } from '../../../types/link';

@Component({
  selector: 'app-home-spotlight',
  standalone: true,
  imports: [RouterModule, ButtonComponent],
  templateUrl: './home-spotlight.component.html',
  styleUrl: './home-spotlight.component.scss',
})
export class HomeSpotlightComponent implements OnInit {
  contentService = inject(ContentService);

  loading = true;
  spotLightArticle: ArticleIndexItem = {
    title: '',
    date: new Date(),
    author: '',
    slug: '',
    excerpt: '',
  };
  renderedContent: string = '';
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;

  ngOnInit() {
    this.loadSpotLightArticle();
  }

  loadSpotLightArticle() {
    this.loading = true;
    // Fetch all articles from TinaCMS GraphQL API
    this.contentService.getLatestArticles('content/reactome-research-spotlight', 1).subscribe({
      next: (result) => {
        this.spotLightArticle = result.map((item: ArticleIndexItem) => ({
          title: item.title,
          date: new Date(item.date),
          author: item.author,
          tags: item.tags || [],
          slug: item.slug,
          excerpt: item.excerpt,
        }))[0];
        this.loading = false;

        // Load the full article content using the slug
        this.contentService
          .getArticle('content/reactome-research-spotlight', this.spotLightArticle.slug)
          .subscribe({
            next: (article) => {
              // Callback kept synchronous: an async one hands a promise to code
              // that ignores it, so any rejection in here would vanish.
              void (async () => {
                const html = await marked(article?.body || '');
                this.renderedContent = truncateHtml(stripFirstH(html), 150);
              })().catch((error) => console.error('Could not render spotlight', error));
            },
          });
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.spotLightArticle = { title: '', date: new Date(), author: '', slug: '', excerpt: '' };
        this.loading = false;
      },
    });
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
