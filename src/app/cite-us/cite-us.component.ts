import { Component } from '@angular/core';
import { CommonModule, NgIf } from '@angular/common';
import { MatIcon } from "@angular/material/icon";
import { ButtonComponent } from "../reactome-components/button/button.component";

@Component({
  selector: 'app-cite-us',
  standalone: true,
  imports: [NgIf, MatIcon, ButtonComponent],
  templateUrl: './cite-us.component.html',
  styleUrl: './cite-us.component.scss'
})
export class CiteUsComponent {
  showText: boolean = false;
  showModal: boolean = false;
  citationType: 'bibtex' | 'ris' | 'plaintext' = 'bibtex';

  citationText: string = 'TODO: Citation text';
  mailToLink: string = '';

  ngOnInit() {
    this.generateCitation();
    this.generateMailto();
  }

  download () {
    var blob = new Blob([this.citationText], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    let filename = 'reactome_citation.';
    if (this.citationType === 'bibtex') {
      filename += 'bib';
    } else if (this.citationType === 'ris') {
      filename += 'ris';
    } else {
      filename += 'txt';
    }
    link.download = filename;
    link.click();
  }

  copyToClipboard() {
    navigator.clipboard.writeText(this.citationText);
  }

  generateMailto() {
    const subject = 'Reactome Citation';
    this.mailToLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(this.citationText)}`;
  }

  generateCitation() {
    //TODO: Generate citation based on current route and citationType
  }
}
