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
import Article from '../../types/article';
import { HomeShortcutsComponent } from './home-shortcuts/home-shortcuts.component';
import { HttpClient, HttpClientModule } from '@angular/common/http';

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
  releaseNotesLink: string = 'TODO';
  private http = inject(HttpClient);

  navOptions: NavOption[] = [];
  latestNews: Article[] = [];
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
    this.loadLatestNews();
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../config/nav-options.json').then((data) => {
      this.navOptions = data.default;

      const toolsOption = this.navOptions.find(option => option.label === 'Tools');
      const pathwayLink = toolsOption?.['dropdown-links']?.find(
        (link) => link.label === 'Pathway Browser'
      )?.link;
      this.pathwayBrowserLink = pathwayLink || '/PathwayBrowser';
    });
  }

  loadLatestNews() {
    this.http.get<Article[]>('/content/news/index.json').subscribe({
      next: (data) => {
        console.log('Loaded news articles:', data);
        this.latestNews = data.slice(0, this.maxArticlesToShow).map(a => {
          const content = a.content || '';
          return {
            title: a.title,
            content: content.slice(0, this.maxExerptLength) + (content.length > this.maxExerptLength ? '...' : ''),
            datePublished: new Date(a.datePublished),
            link: `/news/${a.link}`
          };
        });
        console.log('Processed latest news:', this.latestNews);
      }, error: (err) => {
        console.error('Failed to load latest news:', err);
        this.latestNews = [];
      }
    })
  }
}
