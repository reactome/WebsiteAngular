import { Component, computed, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { UrlStateService } from '../../services/url-state.service';

/**
 * Shows what is flagged and offers a way out of it.
 *
 * Flagging is held in the URL, so a shared or reopened link arrives already
 * flagged. The only control was the toggle in the search panel, which is not
 * showing that state and is not present at all in the genome-wide view -- so
 * there was no way to clear a flag you had not just set yourself (#142). Used
 * by both the diagram and Reacfoam.
 */
@Component({
  selector: 'cr-flag-banner',
  standalone: true,
  imports: [MatIcon, MatIconButton, MatTooltip],
  templateUrl: './flag-banner.component.html',
  styleUrl: './flag-banner.component.scss',
})
export class FlagBannerComponent {
  protected state = inject(UrlStateService);

  /**
   * Tokens are either an identifier the user searched for ("uniprot:P60484")
   * or a class picked from the diagram's context menu
   * ("class:Complex!drug"), and only the class name of the latter is worth
   * showing.
   */
  readonly summary = computed(() =>
    this.state
      .flag()
      .map((token) =>
        token.startsWith('class:') ? token.slice('class:'.length).split(/[!.]/)[0] : token
      )
      .join(', ')
  );

  clear() {
    this.state.flag.set([]);
    // Only qualifies a flag that no longer exists.
    this.state.flagInteractors.set(false);
  }
}
