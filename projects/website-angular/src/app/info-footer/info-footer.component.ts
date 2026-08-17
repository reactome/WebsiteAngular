import { NavOptionsService } from '../../services/nav-options.service';
import { Component, inject } from '@angular/core';

import { KeyValuePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { NavOption } from '../../types/link';

@Component({
  selector: 'app-info-footer',
  standalone: true,
  imports: [RouterModule, MatIcon, KeyValuePipe],
  templateUrl: './info-footer.component.html',
  styleUrl: './info-footer.component.scss',
})
export class InfoFooterComponent {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;

  // Preserve original insertion order for keyvalue pipe
  preserveOrder = () => 0;
}
