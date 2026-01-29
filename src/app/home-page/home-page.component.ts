import { Component, inject, Input } from '@angular/core';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { HomeSpotlightComponent } from './home-spotlight/home-spotlight.component';
import { HomeWhyReactomeComponent } from './home-why-reactome/home-why-reactome.component';
import { HomeLatestNewsComponent } from './home-latest-news/home-latest-news.component';
import { HomeStatsComponent } from './home-stats/home-stats.component';
import { HomeHelpComponent } from './home-help/home-help.component';
import { HomeApiDataComponent } from './home-api-data/home-api-data.component';
import { HomeRelatedComponent } from './home-related/home-related.component';
import { TileComponent } from '../reactome-components/tile/tile.component';
import { ButtonComponent } from '../reactome-components/button/button.component';
import { MatIcon } from '@angular/material/icon';
import NavOption from '../../types/nav-option';
import ExternalLink from '../../types/external-link';
import { ArticleIndexItem } from '../../types/article';
import { HomeShortcutsComponent } from './home-shortcuts/home-shortcuts.component';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { mapNavOptions } from '../../utils/nav-options-mapper';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    SearchBarComponent,
    HomeSpotlightComponent,
    HomeWhyReactomeComponent,
    HomeLatestNewsComponent,
    HomeStatsComponent,
    HomeHelpComponent,
    HomeApiDataComponent,
    HomeRelatedComponent,
    TileComponent,
    ButtonComponent,
    MatIcon,
    HomeShortcutsComponent,
    HttpClientModule,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent {
  releaseNotesLink: string = '';
  feedbackLink: string = '';
  private http = inject(HttpClient);

  navOptions: Record<string, NavOption> = {};
  externalLinks: Record<string, ExternalLink> = {};
  latestNews: ArticleIndexItem[] = [];
  maxArticlesToShow: number = 5;
  maxExerptLength: number = 200;

  pathwayBrowserLink: string = '';
  // testArticle: Article = {
  //   title: 'Test',
  //   link: '#',
  //   datePublished: new Date(),
  //   content: 'This is a test article.',
  // };
  // testArticleList: Article[] = [
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  //   this.testArticle,
  // ];

  ngOnInit() {
    this.loadNavOptions();
    this.loadExternalLinks();
    this.loadLatestNews();
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);

      const pathwayLink = this.navOptions['tools'].dropdownLinks?.['pathway-browser'];
      this.pathwayBrowserLink = pathwayLink?.link || '/PathwayBrowser';
    });
  }

  loadExternalLinks() {
    import('../../config/external-links.json').then((data) => {
      this.externalLinks = data.default;
      this.releaseNotesLink = this.externalLinks['releaseNotes']?.link || '';
      this.feedbackLink = this.externalLinks['feedback']?.link || '';
    });
  }

  loadLatestNews() {
    this.http.get<ArticleIndexItem[]>('/content/news/index.json').subscribe({
      next: (data) => {
        // console.log('Loaded news articles:', data);
        this.latestNews = data.slice(0, this.maxArticlesToShow).map(a => {
          const content = a.excerpt || '';
          return {
            title: a.title,
            author: a.author,
            content: content.slice(0, this.maxExerptLength) + (content.length > this.maxExerptLength ? '...' : ''),
            date: new Date(a.date),
            slug: `about/news/${a.slug}`,
            tags: a.tags,
          };
        });
        // console.log('Processed latest news:', this.latestNews);
      }, error: (err) => {
        console.error('Failed to load latest news:', err);
        this.latestNews = [];
      }
    })
  }
}
