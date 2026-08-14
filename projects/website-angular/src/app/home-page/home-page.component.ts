import { Component, inject, computed } from '@angular/core';
import { SearchBarComponent } from '../search/search-bar/search-bar.component';
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
import { CuratorHomeShortcutsComponent } from './curator-home-shortcuts/curator-home-shortcuts.component';
import { NavOptionsService } from '../../services/nav-options.service';
import { IS_CURATOR } from '../../../../pathway-browser/src/environments/environment';

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
    CuratorHomeShortcutsComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
  host: {
    '[class.curator]': 'isCurator',
  },
})
export class HomePageComponent {
  readonly isCurator = IS_CURATOR;
  readonly navOptions = inject(NavOptionsService).navOptions;
  /** Derived from navOptions; recomputes when the JSON resolves. */
  readonly pathwayBrowserLink = computed(() =>
    this.navOptions()['tools']?.dropdownLinks?.['pathway-browser']?.link || '/PathwayBrowser');

  ngOnInit() {
    // this.loadLatestNews();
  }

}
