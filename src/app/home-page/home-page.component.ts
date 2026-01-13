import { Component } from '@angular/core';
import { SearchBarComponent } from "../search-bar/search-bar.component";
import { HomeShortcutsComponent } from "./home-shortcuts/home-shortcuts.component";
import { HomeSpotlightComponent } from "./home-spotlight/home-spotlight.component";
import { HomeWhyReactomeComponent } from "./home-why-reactome/home-why-reactome.component";
import { HomeLatestNewsComponent } from "./home-latest-news/home-latest-news.component";
import { HomeStatsComponent } from "./home-stats/home-stats.component";
import { HomeHelpComponent } from "./home-help/home-help.component";
import { HomeApiDataComponent } from "./home-api-data/home-api-data.component";
import { HomeRelatedComponent } from "./home-related/home-related.component";

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [SearchBarComponent, HomeShortcutsComponent, HomeSpotlightComponent, HomeWhyReactomeComponent, HomeLatestNewsComponent, HomeStatsComponent, HomeHelpComponent, HomeApiDataComponent, HomeRelatedComponent],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss'
})
export class HomePageComponent {

}
