import { Injectable, Signal, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';

/**
 * A download the page waits for on the user's behalf, rather than handing to
 * the browser and hoping.
 *
 * A diagram's PowerPoint or GIF is rendered on demand and takes seconds. Given
 * an `<a href download>`, the browser shows nothing for that whole time -- no
 * indication that anything is happening, and no way to tell a slow render from
 * a dead link. Worse, a failure is saved: the render service answers a bad id
 * with `404 {"error":"no such pathway"}`, and the browser writes those 41 bytes
 * to `R-HSA-000000.pptx`, which PowerPoint then offers to repair. The user is
 * told nothing and left holding a broken file.
 *
 * So the page asks for the bytes itself, says what is happening while it waits,
 * and saves the file only when the whole of it has arrived and the server said
 * it was good.
 *
 * The service that answers these builds the entire file before it responds, so
 * a response that starts is a response that finishes and `Content-Length` is
 * known. That is deliberate and worth keeping: the Java exporters stream while
 * they generate, which means a mid-render failure produces a truncated file
 * that looks complete, and no size is known in advance either.
 */

/** Where a download has got to. */
export type DownloadPhase =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'transferring'; received: number; total: number | null }
  | { status: 'saved'; bytes: number }
  /** Given to the browser instead, because the page could not fetch it. */
  | { status: 'handed-off' }
  | { status: 'failed'; message: string };

/**
 * Whether a failure means the server refused, or that we never reached it.
 *
 * Status 0 is not an answer: it is a request that did not happen -- blocked by
 * CORS, offline, stopped by an extension. That matters, because the browser can
 * still fetch the file itself, and a reader would rather have the download
 * without a progress bar than a button that does nothing. A real status is a
 * real answer and has to be shown.
 */
export function failureKind(status: number): 'unreachable' | 'refused' {
  return status === 0 ? 'unreachable' : 'refused';
}

/** A download in flight, and the handle to give up on it. */
export interface ManagedDownload {
  readonly phase: Signal<DownloadPhase>;
  cancel(): void;
}

/**
 * The filename the server asked for, or the one we would have used anyway.
 *
 * `Content-Disposition: attachment; filename="R-HSA-109606.pptx"` is what the
 * render service sends. Taking it matters because the URL a figure comes from
 * carries query parameters and, for a reaction, a different id than the file
 * should be named after.
 */
export function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const quoted = /filename\*?=(?:UTF-8'')?"([^"]+)"/i.exec(disposition);
  if (quoted?.[1]) return decodeURIComponent(quoted[1]);
  const bare = /filename\*?=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  // Strip the quotes an empty `filename=""` leaves behind: taken literally that
  // is a file called `""`, which is worse than not reading the header at all.
  const name = (bare?.[1] ?? '').trim().replace(/^"|"$/g, '');
  return name ? decodeURIComponent(name) : fallback;
}

/** The name to fall back on, taken from the URL's last path segment. */
export function filenameFromUrl(url: string, fallback = 'download'): string {
  const path = url.split(/[?#]/)[0];
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last || fallback;
}

/**
 * What to tell the user when it failed.
 *
 * The body of an error carries the reason -- `{"error":"no such pathway: ..."}`
 * -- and that is the sentence worth showing. A status code on its own tells
 * someone nothing they can act on, and "0" is what a cancelled or blocked
 * request reports.
 */
export function messageFrom(status: number, body: string | null): string {
  const trimmed = (body ?? '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
      const reason = parsed.error ?? parsed.message;
      if (typeof reason === 'string' && reason) return reason;
    } catch {
      // Not JSON after all; fall through to the text.
    }
  }
  if (trimmed && trimmed.length < 200 && !trimmed.startsWith('<')) return trimmed;
  if (status === 0) return 'the connection was interrupted';
  if (status === 404) return 'there is nothing to download here';
  if (status === 503) return 'the renderer is busy -- try again in a moment';
  return `the server answered ${status}`;
}

/**
 * The next phase, given an event.
 *
 * A pure step so the state a user sees can be tested without a browser, an
 * HTTP stack, or a real render behind it.
 *
 * `Sent` is followed by nothing at all until the file exists, which is the part
 * that needs saying out loud: a progress bar cannot be honest here, because the
 * server is not sending. Only once bytes arrive is there a fraction to show.
 */
export function nextPhase(event: HttpEvent<Blob>): DownloadPhase | null {
  switch (event.type) {
    case HttpEventType.Sent:
      return { status: 'preparing' };
    case HttpEventType.DownloadProgress:
      return {
        status: 'transferring',
        received: event.loaded,
        total: typeof event.total === 'number' && event.total > 0 ? event.total : null,
      };
    case HttpEventType.Response:
      return { status: 'saved', bytes: event.body?.size ?? 0 };
    default:
      return null;
  }
}

/** A size a person can read, for a download whose total nobody knows. */
export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The short phrase a link shows while it works.
 *
 * The content service's exporters send no `Content-Length` at all -- an 807KB
 * SBML and a 2MB PDF both arrive over eight seconds with no length -- so for
 * those there is no percentage to show, only how much has come. Saying "1.2 MB"
 * is honest where "62%" would be invented.
 */
export function describeProgress(phase: DownloadPhase): string | null {
  switch (phase.status) {
    case 'preparing':
      return 'Preparing…';
    case 'transferring':
      return phase.total
        ? `${Math.min(99, Math.floor((phase.received / phase.total) * 100))}%`
        : describeSize(phase.received);
    case 'failed':
      return 'Failed';
    default:
      return null;
  }
}

@Injectable({ providedIn: 'root' })
export class FileDownloadService {
  private http = inject(HttpClient);

  /**
   * Fetch a file, reporting progress, and save it once it is whole.
   *
   * The caller gets the phase to display and a way to give up. Nothing is
   * written to disk unless the response completed.
   */
  start(url: string, fallbackName?: string): ManagedDownload {
    const phase = signal<DownloadPhase>({ status: 'preparing' });
    let subscription: Subscription | null = null;

    subscription = this.http
      .get(url, { observe: 'events', reportProgress: true, responseType: 'blob' })
      .subscribe({
        next: (event) => {
          const next = nextPhase(event);
          if (next) phase.set(next);

          if (event.type === HttpEventType.Response && event.body) {
            this.save(
              event.body,
              filenameFrom(
                event.headers.get('content-disposition'),
                fallbackName ?? filenameFromUrl(url)
              )
            );
          }
        },
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && failureKind(error.status) === 'unreachable') {
            // Hand it to the browser, which is not bound by CORS for a
            // download. This is how it behaved before any of this existed: no
            // progress, and a failure would be saved -- but a file rather than
            // a button that does nothing.
            this.handOff(url, fallbackName);
            phase.set({ status: 'handed-off' });
            return;
          }
          if (error instanceof HttpErrorResponse) {
            // The body is a Blob because that is what was asked for, so the
            // reason has to be read out of it before it can be shown.
            void this.readError(error).then((message) => phase.set({ status: 'failed', message }));
            return;
          }
          phase.set({ status: 'failed', message: 'the download could not be started' });
        },
      });

    return {
      phase: phase.asReadonly(),
      cancel: () => {
        subscription?.unsubscribe();
        phase.set({ status: 'idle' });
      },
    };
  }

  /**
   * Let the browser fetch it, when the page cannot.
   *
   * `download` is ignored on a cross-origin link, which is exactly the case
   * that brings us here, so the name comes from the server's own
   * Content-Disposition -- which it sends.
   */
  private handOff(url: string, filename?: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    if (filename) anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  private async readError(error: HttpErrorResponse): Promise<string> {
    const body = error.error;
    if (body instanceof Blob) {
      try {
        return messageFrom(error.status, await body.text());
      } catch {
        return messageFrom(error.status, null);
      }
    }
    return messageFrom(error.status, typeof body === 'string' ? body : null);
  }

  /**
   * Hand the finished bytes to the browser.
   *
   * A blob URL and a synthetic click, which is the only way to name a file the
   * page produced. Revoked immediately afterwards: these hold the whole file in
   * memory until the document goes away, and a diagram's GIF is a megabyte.
   */
  private save(blob: Blob, filename: string): void {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Not revoked on the spot. Chromium copes, but revoking a blob URL in the
    // same task as the click cancels the save in other browsers -- and this one
    // holds the whole file, so it cannot simply be left either.
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}
