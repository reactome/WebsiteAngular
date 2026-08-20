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

/**
 * Which version of the renderer a downloaded figure came from.
 *
 * Carried in the URL of every server-rendered figure, purely so that changing
 * the renderer changes the URL. Headers are not enough: a figure is served
 * `public`, so Cloudflare stores it, and a stale entry keeps being served with
 * the max-age it was stored under -- for a day, in the case that sent curators
 * a 2000px GIF after the full-size fix had shipped. Reloading the page does not
 * help either, because a download link's URL is never revalidated.
 *
 * Bump it whenever the renderer's output changes, together with
 * RENDER_CACHE_KEY in tools/render/service.mjs. The service ignores the
 * parameter, so the two versions of a figure share one entry in its own cache;
 * everything downstream sees a new address.
 */
export const RENDER_VERSION = 'v2';

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

  requestDownload(target: DownloadTarget, format: DownloadFormat, options?: DownloadOptions) {
    this.downloadRequest.set({ target, format, options: options || defaultDownloadOptions });
  }

  resetDownload() {
    this.downloadRequest.set(null);
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
