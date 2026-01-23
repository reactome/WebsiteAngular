import { Component } from '@angular/core';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { MatIcon } from "@angular/material/icon";
import NavOption from '../../../types/nav-option';
import { mapNavOptions } from '../../../utils/nav-options-mapper';

@Component({
  selector: 'app-home-help',
  standalone: true,
  imports: [CarouselComponent, ButtonComponent, MatIcon],
  templateUrl: './home-help.component.html',
  styleUrl: './home-help.component.scss'
})
export class HomeHelpComponent {
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
