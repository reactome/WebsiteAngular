import { Component, Input } from '@angular/core';
import { ButtonComponent } from "../../reactome-components/button/button.component";
import NavOption from '../../../types/nav-option';
import { mapNavOptions } from '../../../utils/nav-options-mapper';

@Component({
  selector: 'app-home-spotlight',
  standalone: true,
  imports: [ButtonComponent],
  templateUrl: './home-spotlight.component.html',
  styleUrl: './home-spotlight.component.scss'
})
export class HomeSpotlightComponent {
  @Input() spotLightText: string = '';
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
