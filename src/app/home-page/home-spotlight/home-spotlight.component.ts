import { Component, inject, Input } from '@angular/core';
import { ButtonComponent } from "../../reactome-components/button/button.component";
import NavOption from '../../../types/nav-option';
import { mapNavOptions } from '../../../utils/nav-options-mapper';
import { ArticleIndexItem } from '../../../types/article';
import { ContentService } from '../../../services/content.service';
import formatDate from '../../../utils/formatDate';
import { marked } from 'marked';
import stripFirstH1 from '../../../utils/stripFirstH1';

@Component({
  selector: 'app-home-spotlight',
  standalone: true,
  imports: [ButtonComponent],
  templateUrl: './home-spotlight.component.html',
  styleUrl: './home-spotlight.component.scss'
})
export class HomeSpotlightComponent {
  contentService = inject(ContentService);

  loading = true;
  spotLightArticle: ArticleIndexItem = {title: '', date: new Date(), author: '', slug: '', excerpt: ''};
  renderedContent: string = '';
  navOptions: Record<string, NavOption> = {};

  ngOnInit() {
    this.loadNavOptions();
    this.loadSpotLightArticle();
  }

  loadSpotLightArticle() {
    this.loading = true;
    // Fetch all articles from TinaCMS GraphQL API
    this.contentService.getLatestArticles('content/reactome-research-spotlight', 1).subscribe({
      next: (result) => {
        console.log("Spotlight articles fetched:", result);
        this.spotLightArticle = result.map((item: ArticleIndexItem) => ({
          title: item.title,
          date: new Date(item.date),
          author: item.author,
          tags: item.tags || [],
          slug: item.slug,
          excerpt: item.excerpt
        } ))[0];
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading articles:', err);
        this.spotLightArticle = {title: '', date: new Date(), author: '', slug: '', excerpt: ''};
        this.loading = false;
      }
    });

    console.log("Slug of spotlight article:", this.spotLightArticle.slug);

    this.contentService.getArticle('content/reactome-research-spotlight', this.spotLightArticle.slug).subscribe({
      next: async (article) => {
        console.log("Spotlight article loaded:", article);
        let html = await marked(article?.body || '');
        this.renderedContent = stripFirstH1(html);

      }
    })
  }

  loadNavOptions() {
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }

  formatD(date: Date): string {
    return formatDate(date);
  }
}
