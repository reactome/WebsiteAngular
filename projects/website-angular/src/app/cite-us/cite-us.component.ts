import { Component, inject } from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { CitationService } from '../../../../pathway-browser/src/app/services/citation.service';

@Component({
  selector: 'app-cite-us',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './cite-us.component.html',
  styleUrl: './cite-us.component.scss',
})
export class CiteUsComponent {
  showText: boolean = false;

  private citation: CitationService = inject(CitationService);

  openCitationDialog() {
    // The dialog's code is fetched on first open; a failed fetch is reported.
    this.citation
      .openDialog()
      .catch((error) => console.error('Could not open the citation', error));
  }
}
