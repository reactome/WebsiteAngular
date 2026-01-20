import { Component, Input } from '@angular/core';
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
import { MatIcon } from "@angular/material/icon";
import NavOption from '../../types/nav-option';
import Article from '../../types/article';
import { HomeShortcutsComponent } from "./home-shortcuts/home-shortcuts.component";

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
    HomeShortcutsComponent
],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent {
  @Input() releaseNotesLink: string = 'TODO';

  navOptions: NavOption[] = [];
  navOptionsByLabel: Record<string, NavOption> = {};
  pathwayBrowserLink: string = '';
  testArticle:Article = {title: "Test",link: "#", datePublished: new Date(), content: "This is a test article."};
  testArticleList:Article[] = [this.testArticle,this.testArticle,this.testArticle, this.testArticle,this.testArticle,this.testArticle, this.testArticle, this.testArticle, this.testArticle, this.testArticle, this.testArticle,this.testArticle, this.testArticle, this.testArticle, this.testArticle];
    ngOnInit() {
      this.loadNavOptions();
    }

    loadNavOptions() {
      // Load nav options from the JSON file
      import('../../config/nav-options.json').then((data) => {
        this.navOptions = data.default;
        this.navOptionsByLabel = this.navOptions.reduce((acc, option) => {
          acc[option.label] = option;
          return acc;
        }, {} as Record<string, NavOption>);

        const toolsOption = this.navOptionsByLabel['Tools'];
        const pathwayLink = toolsOption?.['dropdown-links']?.find(link => link.label === 'Pathway Browser')?.link;
        this.pathwayBrowserLink = pathwayLink || '/PathwayBrowser';
      });
    }
}
