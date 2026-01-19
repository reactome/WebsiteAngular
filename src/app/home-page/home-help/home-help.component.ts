import { Component } from '@angular/core';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-home-help',
  standalone: true,
  imports: [CarouselComponent, ButtonComponent, MatIcon],
  templateUrl: './home-help.component.html',
  styleUrl: './home-help.component.scss'
})
export class HomeHelpComponent {

}
