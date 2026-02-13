import { Component } from '@angular/core';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { HomeSpotlightComponent } from './home-spotlight/home-spotlight.component';
import { HomeWhyReactomeComponent } from './home-why-reactome/home-why-reactome.component';
import { HomeLatestNewsComponent } from './home-latest-news/home-latest-news.component';
import { HomeStatsComponent } from './home-stats/home-stats.component';
import { HomeHelpComponent } from './home-help/home-help.component';
import { HomeApiDataComponent } from './home-api-data/home-api-data.component';
import { HomeRelatedComponent } from './home-related/home-related.component';
import { TileComponent } from '../reactome-components/tile/tile.component';
import { NavOption} from '../../types/link';
import { HomeShortcutsComponent } from './home-shortcuts/home-shortcuts.component';
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
    HomeShortcutsComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent {
  navOptions: Record<string, NavOption> = {};

  pathwayBrowserLink: string = '';

  ngOnInit() {
    this.loadNavOptions();
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
}
