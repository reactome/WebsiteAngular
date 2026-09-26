import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TOUR_VIDEO_URL } from '../layout';

/** The former browser's Tour: its walkthrough video, in a dialog. */
@Component({
  selector: 'cr-tour-dialog',
  imports: [MatDialogTitle, MatDialogContent, MatDialogClose, MatIconButton, MatIcon],
  templateUrl: './tour-dialog.component.html',
  styleUrl: './tour-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TourDialogComponent {
  // A constant of ours, not reader input, so trusting it is safe.
  readonly video = inject(DomSanitizer).bypassSecurityTrustResourceUrl(TOUR_VIDEO_URL);
}
