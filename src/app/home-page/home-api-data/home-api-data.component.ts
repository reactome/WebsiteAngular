import { Component } from '@angular/core';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { MatIcon } from "@angular/material/icon";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { mapNavOptions } from '../../../utils/nav-options-mapper';
import { NavOption } from '../../../types/link';

@Component({
  selector: 'app-home-api-data',
  standalone: true,
  imports: [CarouselComponent, MatIcon, ButtonComponent],
  templateUrl: './home-api-data.component.html',
  styleUrl: './home-api-data.component.scss'
})
export class HomeApiDataComponent {
  navOptions: Record<string, NavOption> = {};

  ngOnInit() {
    this.loadNavOptions();
    
  }

  loadNavOptions() {
    // Load nav options from the JSON file
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }
}
