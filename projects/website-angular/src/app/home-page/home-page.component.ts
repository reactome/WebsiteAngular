import { NgOptimizedImage } from '@angular/common';
import { Component, inject, computed, signal } from '@angular/core';
import { SearchBarComponent } from '../search/search-bar/search-bar.component';
import { HomeSpotlightComponent } from './home-spotlight/home-spotlight.component';
import { HomeWhyReactomeComponent } from './home-why-reactome/home-why-reactome.component';
import { HomeLatestNewsComponent } from './home-latest-news/home-latest-news.component';
import { HomeStatsComponent } from './home-stats/home-stats.component';
import { HomeHelpComponent } from './home-help/home-help.component';
import { HomeApiDataComponent } from './home-api-data/home-api-data.component';
import { HomeRelatedComponent } from './home-related/home-related.component';
import { TileComponent } from '../reactome-components/tile/tile.component';
import { HomeShortcutsComponent } from './home-shortcuts/home-shortcuts.component';
import { CuratorHomeShortcutsComponent } from './curator-home-shortcuts/curator-home-shortcuts.component';
import { NavOptionsService } from '../../services/nav-options.service';
import {
  CONTENT_SERVICE,
  IS_CURATOR,
} from '../../../../pathway-browser/src/environments/environment';
import { ContentService } from '../../services/content.service';
import { RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    NgOptimizedImage,
    RouterLink,
    MatIcon,
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
  readonly pathwayBrowserLink = computed(
    () => this.navOptions()['tools']?.dropdownLinks?.['pathway-browser']?.link || '/PathwayBrowser'
  );
  /**
   * The newest release's featured pathway, for the hero: the first pathway its
   * announcement links to (V98's opens with Developmental Cell Lineages of the
   * Endocrine Pancreas), drawn by the content service's image export. From the
   * news, so it follows each release with nothing to update here; none, and the
   * hero is the search alone.
   */
  readonly featured = signal<FeaturedPathway | null>(null);

  constructor() {
    if (IS_CURATOR) return;
    inject(ContentService)
      .getLatestArticles('about/news', 10)
      .subscribe({
        next: (articles) => {
          for (const article of articles) {
            const release = releaseOf(article.title);
            if (!release) continue;
            this.featured.set(featuredIn(article.excerpt ?? '', release));
            return;
          }
        },
        // The hero stands without it.
        error: () => undefined,
      });
  }

  /** Searches to try, each opening the results the search box would: a gene, a topic, a pathway's id. */
  readonly examples = ['TP53', 'Apoptosis', 'R-HSA-109581'];
}

interface FeaturedPathway {
  release: string;
  name: string;
  stId: string;
  image: string;
}

/** "V97 Released", "Version 98 Released": the release a headline announces, or null. */
function releaseOf(title: string): string | null {
  const number = /^\s*(?:V|Version\s+)(\d+)\b/i.exec(title)?.[1];
  return number ? `V${number}` : null;
}

/** The first pathway an announcement links to, `[name](</PathwayBrowser/#R-HSA-n>)` or `#n`. */
export function featuredIn(markdown: string, release: string): FeaturedPathway | null {
  const link = /\[([^\]]+)\]\(<?\/PathwayBrowser\/#(?:R-HSA-)?(\d+)>?\)/.exec(markdown);
  if (!link?.[1] || !link[2]) return null;
  const stId = `R-HSA-${link[2]}`;
  return {
    release,
    name: link[1].trim(),
    stId,
    image: `${CONTENT_SERVICE}/exporter/diagram/${stId}.png?quality=3`,
  };
}
