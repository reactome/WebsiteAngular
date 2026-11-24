import { Component, inject, signal } from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { CitationService } from '../../../../pathway-browser/src/app/services/citation.service';

@Component({
  selector: 'app-cite-us',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './cite-us.component.html',
  styleUrl: './cite-us.component.scss',
  host: { '(window:scroll)': 'onScroll()' },
})
export class CiteUsComponent {
  showText: boolean = false;

  /**
   * Out of the way while the reader scrolls down, back when they scroll up.
   * On a phone it sat over a line of every page (the CSS applies it only on
   * narrow screens). Proposal of the second UI review, 23 Nov 2026.
   */
  readonly tucked = signal(false);
  private lastScrollY = 0;

  onScroll(): void {
    const y = window.scrollY;
    if (y > this.lastScrollY + 4 && y > 120) this.tucked.set(true);
    else if (y < this.lastScrollY - 4) this.tucked.set(false);
    this.lastScrollY = y;
  }

  private citation: CitationService = inject(CitationService);

  openCitationDialog() {
    // The dialog's code is fetched on first open; a failed fetch is reported.
    this.citation
      .openDialog()
      .catch((error) => console.error('Could not open the citation', error));
  }
}
