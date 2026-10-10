import { Component, inject, OnInit, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { CarouselComponent } from '../../reactome-components/carousel/carousel.component';
import { StatsService } from '../../../services/stats.service';
import { APP_CONFIG } from '../../../config/config'; // NEW import
import { IS_CURATOR } from 'projects/pathway-browser/src/environments/environment';
import { LoadErrorComponent } from '../../reactome-components/load-error/load-error.component';

interface Stats {
  human_pathways: number;
  reactions: number;
  proteins: number;
  small_molecules: number;
  drugs: number;
  references: number;
}

@Component({
  selector: 'app-home-stats',
  standalone: true,
  imports: [MatIcon, CarouselComponent, LoadErrorComponent],
  templateUrl: './home-stats.component.html',
  styleUrl: './home-stats.component.scss',
})
export class HomeStatsComponent implements OnInit {
  private statsService = inject(StatsService);

  // The curation graph is not a release, so the heading names the database
  // instead of announcing a release date.
  readonly isCurator = IS_CURATOR;

  /**
   * The release, straight from the database. A computed rather than a field:
   * the answer arrives after this component first renders, and a field read once
   * in ngOnInit would keep whatever was true then -- which, with no build-time
   * fallback, is nothing at all.
   */
  readonly versionLabel = this.statsService.versionLabel;
  releaseDate: Date = new Date();
  /**
   * A signal, for the same reason: the numbers arrive after the first render,
   * and in this zoneless app a plain field written then is not drawn -- the
   * counters stayed at 0 unless something else redrew the page, and in
   * development a reply landing mid-check threw NG0100.
   *
   * Null until they arrive. It used to start at zeros, so the page announced a
   * release of nothing while it waited, and for good when the file failed.
   */
  readonly stats = signal<Stats | null>(null);
  readonly failed = signal(false);

  ngOnInit() {
    this.getVersionAndDate();
  }

  getVersionAndDate() {
    this.releaseDate = new Date(APP_CONFIG.version.releaseDate);
    this.fetchStats();
  }

  fetchStats() {
    this.statsService
      .getStats()
      .then((resp) => {
        resp.subscribe({
          next: (data) => {
            this.stats.set({
              human_pathways: data.pathways,
              reactions: data.reactions,
              proteins: data.proteins,
              small_molecules: data.smallMolecules,
              drugs: data.drugs,
              references: data.references,
            });
          },
          error: (err) => {
            console.error('Error while fetching stats: ', err);
            this.failed.set(true);
          },
        });
      })
      .catch((error) => {
        console.error('Could not load homepage statistics', error);
        this.failed.set(true);
      });
  }

  /**
   * A count, or a dash while it is not known yet: unknown is not zero. Null as
   * well as undefined: a template's `stats()?.x` gives null, not undefined.
   */
  formatNumber(num: number | null | undefined): string {
    return num == null ? '–' : num.toLocaleString('en-US');
  }
}
