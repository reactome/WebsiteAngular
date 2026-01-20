import { Component } from '@angular/core';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-home-shortcuts',
  imports: [CarouselComponent, ButtonComponent, MatIcon],
  templateUrl: './home-shortcuts.component.html',
  styleUrl: './home-shortcuts.component.scss'
})
export class HomeShortcutsComponent {

}
