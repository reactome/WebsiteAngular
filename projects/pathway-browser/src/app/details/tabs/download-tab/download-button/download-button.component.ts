import { Component, input, output } from '@angular/core';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { ManagedDownloadDirective } from '../../../../services/managed-download.directive';

export type Icon = { id: string; svg?: boolean };

/**
 * A download button that says what is happening.
 *
 * Some of these files are made on demand: a diagram's PowerPoint or GIF is a
 * headless render and takes seconds. Left to the browser, an `<a href download>`
 * gives no sign that anything is happening for that whole time, and a failure
 * is written to disk -- the render service answers a bad id with
 * `404 {"error":"no such pathway"}` and the browser saves those 41 bytes as a
 * `.pptx`.
 *
 * The waiting, the saving and the failing all live in `ManagedDownloadDirective`
 * -- this had its own copy of that logic until the two drifted apart, and every
 * edge case had to be found twice. What is left here is what the button looks
 * like: a spinner in the icon's place, and the state beside the label.
 *
 * It stays a real anchor. Middle-click, right-click and "Save link as" keep
 * working, and a modified click is left to the browser.
 */
@Component({
  selector: 'cr-download-button',
  imports: [MatAnchor, MatTooltip, MatIcon, MatProgressSpinner, ManagedDownloadDirective],
  templateUrl: './download-button.component.html',
  styleUrl: './download-button.component.scss',
})
export class DownloadButtonComponent {
  url = input<string>();
  download = input<string | boolean>();
  icon = input<Icon>();

  label = input<string>();
  tooltip = input<string>();
  openInNewTab = input<string>('_blank');
  click = output<void>();

  onClick(event: MouseEvent) {
    event.stopPropagation();
    this.click.emit();
  }
}
