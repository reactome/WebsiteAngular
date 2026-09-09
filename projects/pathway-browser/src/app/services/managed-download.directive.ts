import { Directive, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { DestroyRef } from '@angular/core';
import {
  DownloadPhase,
  FileDownloadService,
  ManagedDownload,
  describeProgress,
} from './file-download.service';

/**
 * Turns a download link into one that says what is happening.
 *
 * Put on an `<a href download>`, it stops the browser taking the link and
 * fetches the file itself: the reader gets told the file is being made, and a
 * failure is shown rather than written to disk.
 *
 * This matters most where the wait is longest. The content service's exporters
 * take up to eight seconds for a pathway's SBML or PDF, and they send no
 * `Content-Length` -- they stream while they generate, so the browser cannot
 * know how big the file is, and a failure part-way through leaves a truncated
 * file that looks complete. Fetching it here cannot stop the streaming, but a
 * stream that breaks throws, and nothing broken gets saved.
 *
 * A directive rather than a component because these links are plain text in a
 * dense toolbar; the state shows through attributes and the stylesheet, so no
 * markup has to be rebuilt around them.
 */
@Directive({
  selector: 'a[crManagedDownload]',
  host: {
    '[class.dl--busy]': 'busy()',
    '[class.dl--failed]': 'failed()',
    '[attr.data-download-state]': 'label()',
    '[attr.aria-busy]': 'busy() ? "true" : null',
    '[attr.title]': 'reason()',
  },
})
export class ManagedDownloadDirective {
  private downloads = inject(FileDownloadService);
  private anchor = inject<ElementRef<HTMLAnchorElement>>(ElementRef);
  private active = signal<ManagedDownload | null>(null);

  constructor() {
    // These take seconds. A reader who moves on should not have a file arrive
    // on a page they have left.
    inject(DestroyRef).onDestroy(() => this.active()?.cancel());
  }

  private phase = computed<DownloadPhase>(() => this.active()?.phase() ?? { status: 'idle' });

  readonly busy = computed(() => {
    const status = this.phase().status;
    return status === 'preparing' || status === 'transferring';
  });

  readonly failed = computed(() => this.phase().status === 'failed');

  readonly label = computed(() => describeProgress(this.phase()));

  readonly reason = computed(() => {
    const phase = this.phase();
    return phase.status === 'failed' ? `Could not download: ${phase.message}` : null;
  });

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    // A modified click is the reader asking the browser to handle it.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    const element = this.anchor.nativeElement;
    const url = element.getAttribute('href');
    if (!url) return;

    event.preventDefault();
    if (this.busy()) return;

    const name = element.getAttribute('download');
    this.active.set(this.downloads.start(url, name || undefined));
  }
}
