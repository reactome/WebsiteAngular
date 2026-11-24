import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-home-api-data',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './home-api-data.component.html',
  styleUrl: './home-api-data.component.scss',
})
export class HomeApiDataComponent {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;
}
