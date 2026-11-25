import { Component, inject, signal } from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { CitationService } from '../../../../pathway-browser/src/app/services/citation.service';

/** How far down a page counts as its top, where the button keeps out of the way on a phone. */
const TOP = 120;

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
  //
  // At the top of a page too (outreach, 24 Nov 2026): there it sat over
  // whatever the first screen ends with -- on the home page, the caption of
  // the release's illustration. It comes back when the reader scrolls up from
  // further down; the footer's "Citing Us" is always there.
  readonly tucked = signal(true);
  private lastScrollY = 0;

  onScroll(): void {
    const y = window.scrollY;
    if (y <= TOP || y > this.lastScrollY + 4) this.tucked.set(true);
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
