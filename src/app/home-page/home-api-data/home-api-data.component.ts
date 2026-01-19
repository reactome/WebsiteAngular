import { Component } from '@angular/core';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { MatIcon } from "@angular/material/icon";
import { ButtonComponent } from "../../reactome-components/button/button.component";

@Component({
  selector: 'app-home-api-data',
  standalone: true,
  imports: [CarouselComponent, MatIcon, ButtonComponent],
  templateUrl: './home-api-data.component.html',
  styleUrl: './home-api-data.component.scss'
})
export class HomeApiDataComponent {

}
