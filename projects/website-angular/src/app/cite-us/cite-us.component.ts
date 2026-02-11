import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { MatIcon } from "@angular/material/icon";
import { CitationService } from "../../../../pathway-browser/src/app/services/citation.service";

@Component({
  selector: 'app-cite-us',
  standalone: true,
  imports: [NgIf, MatIcon],
  templateUrl: './cite-us.component.html',
  styleUrl: './cite-us.component.scss'
})
export class CiteUsComponent {
  showText: boolean = false;
  
  private citation: CitationService = inject(CitationService);

  openCitationDialog() {
    this.citation.openDialog();
  }
}
