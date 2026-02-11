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
import {ExternalLink, NavOption} from '../../types/link';
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
  // latestNews: ArticleIndexItem[] = [];
  // maxArticlesToShow: number = 5;
  // maxExerptLength: number = 200;

  pathwayBrowserLink: string = '';

  ngOnInit() {
    this.loadNavOptions();
    this.loadExternalLinks();
    // this.loadLatestNews();
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
      this.externalLinks = mapNavOptions(data.default);
      this.releaseNotesLink = this.externalLinks['releaseNotes']?.link || '';
      this.feedbackLink = this.externalLinks['feedback']?.link || '';
    });
  }
}
