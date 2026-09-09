import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { FileDownloadService, ManagedDownload } from '../../../../services/file-download.service';

export type Icon = { id: string; svg?: boolean };

/**
 * A download button that says what is happening.
 *
 * Some of these files are made on demand: a diagram's PowerPoint or GIF is a
 * headless render and takes seconds. Left to the browser, an `<a href download>`
 * gives no sign that anything is happening for that whole time, and a failure
 * is written to disk -- the render service answers a bad id with
 * `404 {"error":"no such pathway"}` and the browser saves those 41 bytes as a
 * `.pptx`. So when the button is a link to a file, the page fetches it itself,
 * shows a spinner while the file is being made, and saves it only once the
 * whole of it has arrived.
 *
 * It stays a real anchor. Middle-click, right-click and "Save link as" keep
 * working, and if the click handler never runs the link is still a link.
 */
@Component({
  selector: 'cr-download-button',
  imports: [MatAnchor, MatTooltip, MatIcon, MatProgressSpinner],
  templateUrl: './download-button.component.html',
  styleUrl: './download-button.component.scss',
})
export class DownloadButtonComponent {
  private downloads = inject(FileDownloadService);

  url = input<string>();
  download = input<string | boolean>();
  icon = input<Icon>();

  label = input<string>();
  tooltip = input<string>();
  openInNewTab = input<string>('_blank');
  click = output<void>();

  private active = signal<ManagedDownload | null>(null);

  constructor() {
    // A render takes seconds, and a reader who moves on should not leave one
    // running: the request would finish into a component that no longer exists
    // and drop a file on a page they have left.
    inject(DestroyRef).onDestroy(() => this.active()?.cancel());
  }

  private phase = computed(() => this.active()?.phase() ?? { status: 'idle' as const });

  /** Whether this button fetches the file itself rather than following a link. */
  private readonly managed = computed(() => Boolean(this.url()) && Boolean(this.download()));

  readonly busy = computed(() => {
    const phase = this.phase();
    return phase.status === 'preparing' || phase.status === 'transferring';
  });

  readonly failed = computed(() => this.phase().status === 'failed');

  /**
   * What the button says while it works.
   *
   * "Preparing" rather than 0%: until the file exists the server is not
   * sending, so a percentage would be a number we made up. Once bytes arrive
   * there is a real fraction, and it is only shown when the server said how
   * many to expect.
   */
  readonly state = computed(() => {
    const phase = this.phase();
    switch (phase.status) {
      case 'preparing':
        return 'Preparing…';
      case 'transferring':
        return phase.total
          ? `${Math.min(99, Math.floor((phase.received / phase.total) * 100))}%`
          : 'Downloading…';
      case 'failed':
        return 'Failed';
      default:
        return null;
    }
  });

  readonly hint = computed(() => {
    const phase = this.phase();
    if (phase.status === 'failed') return `Could not download: ${phase.message}. Click to retry.`;
    if (phase.status === 'preparing') return 'The file is being made on the server…';
    return this.tooltip();
  });

  onClick(event: MouseEvent) {
    event.stopPropagation();
    this.click.emit();

    const url = this.url();
    if (!this.managed() || !url) return;

    // A modified click is the reader asking the browser to handle it: a new
    // tab, a save-as, a window. Leave those alone.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();

    if (this.busy()) return;
    const name = this.download();
    this.active.set(this.downloads.start(url, typeof name === 'string' ? name : undefined));
  }
}
