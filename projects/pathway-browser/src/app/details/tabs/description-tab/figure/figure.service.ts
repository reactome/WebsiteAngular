import { effect, Injectable, signal, inject } from '@angular/core';
import { Figure } from '../../../../model/graph/figure.model';
import { DataStateService } from '../../../../services/data-state.service';
import { environment } from '../../../../../environments/environment';

/**
 * The URL to try first: the release bucket, outside any version.
 *
 * Figures are not release artefacts. Icons and illustrations are regenerated per
 * release, which is why the bucket versions those; a figure is a curated image
 * that the database references by a stable, version-free path and that is the
 * same file in release 95 and 97. Copying 150MB into every release directory
 * four times a year would buy nothing, and keying the URL on the release meant
 * no figure could be addressed until /data/database/version had answered.
 *
 * Exported, with the fallback below, because the detail page substitutes its own
 * FigureService and the two must not disagree about where figures live.
 */
export function figureSrc(figure: Figure) {
  return !environment.assetsFromHost ? `${environment.s3}${figure.url}` : figureOnOrigin(figure);
}

/** Where figures have always been served from: the legacy document root. */
export function figureOnOrigin(figure: Figure) {
  return `${environment.host}${figure.url}`;
}

/**
 * Put an image that failed back on our own origin, once.
 *
 * Without the guard a genuinely missing figure retries forever: the fallback
 * fails too, which fires error again. Eleven of the figures the database names
 * are missing from every host, so this path is real.
 */
export function figureFallback(event: Event, figure: Figure) {
  const image = event.target as HTMLImageElement;
  const origin = figureOnOrigin(figure);
  if (image.src === origin) return;
  image.src = origin;
}

@Injectable({
  providedIn: 'root',
})
export class FigureService {
  private data = inject(DataStateService);

  readonly expanded = signal<Figure | undefined>(undefined);

  /** The URL to try first for a figure. */
  src(figure: Figure) {
    return figureSrc(figure);
  }

  /** Where the figure has always been served from. */
  onOrigin(figure: Figure) {
    return figureOnOrigin(figure);
  }

  /** Put an image that failed back on our own origin. */
  fallback(event: Event, figure: Figure) {
    figureFallback(event, figure);
  }

  toggle(figure: Figure) {
    this.expanded.update((prev) => (prev === figure ? undefined : figure));
  }

  constructor() {
    effect(() => {
      this.data.selectedElement() && this.expanded.set(undefined); // reset expanded when element changes
    });
  }
}
