import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject } from '@angular/core';
import { CarouselComponent } from '../../reactome-components/carousel/carousel.component';
import { MatIcon } from '@angular/material/icon';
import { ButtonComponent } from '../../reactome-components/button/button.component';
import { NavOption } from '../../../types/link';

@Component({
  selector: 'app-home-api-data',
  standalone: true,
  imports: [CarouselComponent, MatIcon, ButtonComponent],
  templateUrl: './home-api-data.component.html',
  styleUrl: './home-api-data.component.scss',
})
export class HomeApiDataComponent {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;
}
