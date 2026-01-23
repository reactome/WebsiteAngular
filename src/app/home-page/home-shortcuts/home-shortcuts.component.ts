import { Component } from '@angular/core';
import { CarouselComponent } from "../../reactome-components/carousel/carousel.component";
import { ButtonComponent } from "../../reactome-components/button/button.component";
import { MatIcon } from "@angular/material/icon";
import NavOption from '../../../types/nav-option';
import { mapNavOptions } from '../../../utils/nav-options-mapper';

@Component({
  selector: 'app-home-shortcuts',
  imports: [CarouselComponent, ButtonComponent, MatIcon],
  templateUrl: './home-shortcuts.component.html',
  styleUrl: './home-shortcuts.component.scss'
})
export class HomeShortcutsComponent {
  navOptions: Record<string, NavOption> = {};

  ngOnInit() {
    this.loadNavOptions();
  }

  loadNavOptions() {
    import('../../../config/nav-options.json').then((data) => {
      this.navOptions = mapNavOptions(data.default);
    });
  }
}
