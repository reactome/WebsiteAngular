import { Component, inject } from '@angular/core';
import { MatIcon } from "@angular/material/icon";
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { StatsService } from '../../../services/stats.service';
import { APP_CONFIG } from '../../../config/config'; // NEW import

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
  imports: [MatIcon, CarouselComponent],
  templateUrl: './home-stats.component.html',
  styleUrl: './home-stats.component.scss'
})
export class HomeStatsComponent {
  private statsService = inject(StatsService);

  version: string = '';
  releaseDate: Date = new Date();
  stats: Stats = {
    human_pathways: 0,
    reactions: 0,
    proteins: 0,
    small_molecules: 0,
    drugs: 0,
    references: 0
  };

  ngOnInit() {
    this.getVersionAndDate();
  }

  getVersionAndDate () {
    // Use APP_CONFIG instead of dynamic JSON import
    this.version = APP_CONFIG.version.releaseNumber;
    this.releaseDate = new Date(APP_CONFIG.version.releaseDate);
    this.fetchStats();
  }

  fetchStats () {
    this.statsService.getStats().then(resp => {
      resp.subscribe({
        next: (data) => {
          this.stats = {
            human_pathways: data.pathways,
            reactions: data.reactions,
            proteins: data.proteins,
            small_molecules: data.smallMolecules,
            drugs: data.drugs,
            references: data.references,
          };
        },
        error: (err) => {
          console.error("Error while fetching stats: ", err);
        }
      })
      
    });
  }

  formatNumber (num: number): string {
    return num.toLocaleString('en-US');
  }

}