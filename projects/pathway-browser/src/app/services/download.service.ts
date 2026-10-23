import { Injectable, signal } from '@angular/core';

export enum DownloadTarget {
  REACFOAM = 'reacfoam',
  DIAGRAM = 'diagram',
}

export enum DownloadFormat {
  SVG = 'svg',
  PNG = 'png',
  JPEG = 'jpeg',
  PPTX = 'pptx',
  GIF = 'gif',
}

export const IMAGES_FORMAT = {
  PNG: DownloadFormat.PNG,
  JPEG: DownloadFormat.JPEG,
} as const;

export interface DownloadOptions {
  animate: boolean;
  includeLegend: boolean;
  includeTimeline: boolean;
  timePerFrame: number;
  transitionTime: number;
}

/**
 * Whether an exported diagram carries the sub-pathway tints and their labels.
 *
 * They are navigational aids: useful on screen, and noise in a figure, where
 * they compete with the biology for attention. One preference rather than a
 * second button beside every format -- it is a property of the picture, not a
 * different kind of file -- and it travels to the headless renderer as a
 * parameter.
 */
export const includeSubpathways = signal(true);

export const defaultDownloadOptions: DownloadOptions = {
  animate: false,
  includeLegend: true,
  includeTimeline: true,
  timePerFrame: 2,
  transitionTime: 0.1,
};

export type ImageType = (typeof IMAGES_FORMAT)[keyof typeof IMAGES_FORMAT];

export type DownloadRequest = {
  target: DownloadTarget.DIAGRAM | DownloadTarget.REACFOAM;
  format: DownloadFormat;
  options?: DownloadOptions;
} | null;

/**
 * How long a figure may take before the button gives up on it. An animated
 * illustration across many samples is the slowest thing made here; the files
 * fetched from the server get the same three minutes.
 */
export const FIGURE_DEADLINE_MS = 3 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class DownloadService {
  readonly downloadRequest = signal<DownloadRequest>(null);

  /**
   * Why the last download did not happen, for the reader rather than the console.
   *
   * A figure made in the browser is produced by whichever component draws the
   * view, and all three of them reported a failure with `console.error` and
   * nothing else. So a download that could not be made looked exactly like a
   * button that does nothing: no file, no message, and no reason to think the
   * click had registered.
   *
   * Found on the one illustration a browser refuses to rasterise -- Circadian
   * clock embeds HTML in a `<foreignObject>`, which taints the canvas -- where
   * the reason was known, specific and useful, and went to a console nobody
   * had open.
   */
  readonly failure = signal<string | null>(null);

  /**
   * The figure being made in the page, from the click until it is saved or has
   * failed.
   *
   * Not `downloadRequest`, which is a message to whichever component draws the
   * view and is cleared when that component picks it up -- the diagram does so
   * before it has drawn anything. A large illustration takes seconds to draw,
   * and with nothing on the button in that time the click looked lost.
   */
  readonly working = signal<{ target: DownloadTarget; format: DownloadFormat } | null>(null);
  private deadline: ReturnType<typeof setTimeout> | undefined;

  requestDownload(target: DownloadTarget, format: DownloadFormat, options?: DownloadOptions) {
    // One at a time: the drawers share one request, so a second click while a
    // figure is being made would replace the first one's request mid-draw.
    if (this.working()) return;
    // A new request clears the last one's complaint; otherwise a reason that has
    // been dealt with sits under a download that is working.
    this.failure.set(null);
    this.working.set({ target, format });
    // A request nothing picks up -- no view drawn to take it -- would otherwise
    // leave the button working for good.
    this.deadline = setTimeout(
      () =>
        this.failed(
          new Error('The figure was not made in time; please try again'),
          'Figure timed out'
        ),
      FIGURE_DEADLINE_MS
    );
    this.downloadRequest.set({ target, format, options: options || defaultDownloadOptions });
  }

  /** The figure has been saved. */
  finished() {
    clearTimeout(this.deadline);
    this.working.set(null);
  }

  resetDownload() {
    this.downloadRequest.set(null);
  }

  /**
   * A download that could not be produced: say why, and stop saying it is on its
   * way. `whatFailed` names the exporter for the console; the reader gets the
   * error's own message when it has one, because those are written to be read.
   */
  failed(error: unknown, whatFailed: string) {
    console.error(whatFailed, error);
    this.failure.set(error instanceof Error && error.message ? error.message : whatFailed);
    this.resetDownload();
    this.finished();
  }

  constructor() {}

  isRasterFormat(format: DownloadFormat): format is ImageType {
    return format === DownloadFormat.PNG || format === DownloadFormat.JPEG;
  }

  toFoamtreeType(format: ImageType) {
    return `image/${format}` as 'image/png' | 'image/jpeg';
  }

  /**
   * Save a file the page has made: a Blob, a data: URL, a blob: URL, or an
   * address.
   *
   * A data: URL is the whole file written into the link, and Chrome follows no
   * link longer than 2 MB. An illustration's PNG and JPEG are drawn at three
   * times their size on screen, which made the one reported 2.7 and 2.5 MB of
   * link: those failed as "Site wasn't available" while its SVG saved. So the
   * file goes through a blob: URL, which is short however large the file. A
   * data: URL is still accepted, for the genome-wide view, whose library gives
   * nothing else.
   */
  export(data: string | Blob, format: DownloadFormat, name = 'reacfoam') {
    const blob = typeof data === 'string' && data.startsWith('data:') ? dataUrlToBlob(data) : data;
    const url = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${format}`;
    a.click();
    a.remove();
    // Not at once: the browser reads the blob after the click returns.
    if (url !== data) setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** A data: URL's bytes and type, as a Blob. */
export function dataUrlToBlob(data: string): Blob {
  const comma = data.indexOf(',');
  const header = data.slice(5, comma);
  const body = data.slice(comma + 1);
  const type = header.split(';')[0] || 'text/plain';
  if (!header.toLowerCase().split(';').includes('base64'))
    return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return new Blob([bytes], { type });
}
