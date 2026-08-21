import { effect, Injectable, signal, inject } from '@angular/core';
import { Figure } from '../../../../model/graph/figure.model';
import { DataStateService } from '../../../../services/data-state.service';
import { GeneralService } from '../../../../services/general.service';
import { environment } from '../../../../../environments/environment';

/** Where a figure's image comes from, given the release being served. */
function figureBucket(version: number | undefined) {
  return environment.preferS3 && version ? `${environment.s3}/${version}` : '';
}

/**
 * The URL to try first: the release bucket if we can name a release.
 *
 * Exported, along with the two below, because the detail page substitutes its own
 * FigureService and the two must not disagree about where figures live.
 */
export function figureSrc(figure: Figure, version: number | undefined) {
  const bucket = figureBucket(version);
  return bucket ? `${bucket}${figure.url}` : figureOnOrigin(figure);
}

/** Where figures have always been served from. */
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
  private general = inject(GeneralService);

  readonly expanded = signal<Figure | undefined>(undefined);

  /** The URL to try first for a figure. */
  src(figure: Figure) {
    return figureSrc(figure, this.general.version.value());
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
