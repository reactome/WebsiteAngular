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

  requestDownload(target: DownloadTarget, format: DownloadFormat, options?: DownloadOptions) {
    // A new request clears the last one's complaint; otherwise a reason that has
    // been dealt with sits under a download that is working.
    this.failure.set(null);
    this.downloadRequest.set({ target, format, options: options || defaultDownloadOptions });
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
  }

  constructor() {}

  isRasterFormat(format: DownloadFormat): format is ImageType {
    return format === DownloadFormat.PNG || format === DownloadFormat.JPEG;
  }

  toFoamtreeType(format: ImageType) {
    return `image/${format}` as 'image/png' | 'image/jpeg';
  }

  export(data: string, format: DownloadFormat, name = 'reacfoam') {
    const a = document.createElement('a');
    a.href = data;
    a.download = `${name}.${format}`;
    a.click();
    a.remove();
  }
}
