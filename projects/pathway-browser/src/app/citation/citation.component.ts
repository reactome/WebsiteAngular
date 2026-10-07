import { Component, computed, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { Citation, CitationService } from '../services/citation.service';
import { DownloadButtonComponent } from '../details/tabs/download-tab/download-button/download-button.component';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'cr-citation',
  imports: [
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatDialogTitle,
    DownloadButtonComponent,
    MatIcon,
    MatIconButton,
    CdkCopyToClipboard,
    MatButton,
    FormsModule,
    MatAnchor,
  ],
  templateUrl: './citation.component.html',
  styleUrl: './citation.component.scss',
})
export class CitationComponent {
  citation = inject(CitationService);

  data: Citation = inject(MAT_DIALOG_DATA);

  id = this.data.id;
  citationContent = this.data.content;
  downloadItems = this.data.downloadItems;

  readonly copyLabel = signal('Copy');
  readonly copyIcon = signal('content_copy');

  readonly staticCitation = computed(() => {
    return !this.citation.isPathwayCitation(this.citationContent()) ? this.citationContent() : null;
  });

  readonly imageCitation = computed(() => {
    const content = this.citationContent();
    return this.citation.isPathwayCitation(content) ? content.imageCitation : null;
  });

  readonly pathwayCitation = computed(() => {
    const content = this.citationContent();
    return this.citation.isPathwayCitation(content) ? content.pathwayCitation : null;
  });

  readonly citationToCopy = computed(() => {
    if (this.staticCitation()) return (this.staticCitation() as string) ?? '';
    const content = [];
    if (this.pathwayCitation()) content.push('Pathway: ' + this.pathwayCitation());
    if (this.imageCitation()) content.push('Image: ' + this.imageCitation());
    return content.join('\n');
  });

  readonly citationToMail = computed(() => encodeURI(this.citationToCopy()));

  onCopyClick() {
    this.copyLabel.set('Copied');
    this.copyIcon.set('done');
  }
}
