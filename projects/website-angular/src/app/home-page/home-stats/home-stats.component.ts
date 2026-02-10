import { Component } from '@angular/core';
import { MatIcon } from "@angular/material/icon";
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";

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
    import('../../../config/config.json').then((data) => {
        this.version = data.default.version.label;
        this.releaseDate = new Date(data.default.version.releaseDate);
        this.fetchStats();
      });
  }

  fetchStats () {
    const version = this.version && this.version.trim().length > 0 ? this.version.slice(1) : '95';
    // Use relative path so dev-server proxy can avoid CORS
    const urlPath = `/reactome/${version}/stats/summary_stats.json`;
    fetch(urlPath)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
        return res.json();
      })
      .then((data: any) => {
        if (Array.isArray(data)) {
          const val = (name: string): number => {
            const item = data.find((x: any) => x && x.name === name);
            const n = item ? parseInt(item.value, 10) : 0;
            return Number.isFinite(n) ? n : 0;
          };

          const proteins = val('prot') || val('netProt');
          const reactions = val('rxn');
          const references = val('litRef');
          const smallMolecules = val('chemicals');
          const humanPathways = val('pathway');
          const drugs = val('chemDrug') + val('protDrug');

          this.stats = {
            human_pathways: humanPathways,
            reactions,
            proteins,
            small_molecules: smallMolecules,
            drugs,
            references,
          };
        } else {
          // Fallback: unknown format
          this.stats = {
            human_pathways: 0,
            reactions: 0,
            proteins: 0,
            small_molecules: 0,
            drugs: 0,
            references: 0
          };
        }
      })
      .catch(err => {
        console.error(err);
      });
  }

  formatNumber (num: number): string {
    return num.toLocaleString('en-US');
  }

}