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
  version: string = '1.21.11';
  releaseDate: Date = new Date('2024-06-15');
  stats: Stats = {
    human_pathways: 1234,
    reactions: 0,
    proteins: 0,
    small_molecules: 42,
    drugs: 0,
    references: 67
  };
}