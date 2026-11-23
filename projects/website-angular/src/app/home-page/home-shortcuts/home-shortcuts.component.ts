import { NavOptionsService } from '../../../services/nav-options.service';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'app-home-shortcuts',
  imports: [MatIcon, RouterLink],
  templateUrl: './home-shortcuts.component.html',
  styleUrl: './home-shortcuts.component.scss',
})
export class HomeShortcutsComponent {
  /** Shared, loaded once by NavOptionsService (a signal, so it renders when it arrives). */
  readonly navOptions = inject(NavOptionsService).navOptions;
  readonly dark = input<boolean>(true);
}
