import { Injectable, inject, signal } from '@angular/core';
import {
  FigureService,
  figureFallback,
  figureOnOrigin,
  figureSrc,
} from '../../../../../../pathway-browser/src/app/details/tabs/description-tab/figure/figure.service';
import { Figure } from '../../../../../../pathway-browser/src/app/model/graph/figure.model';
import { GeneralService } from '../../../../../../pathway-browser/src/app/services/general.service';

/**
 * The detail page's own figure state: no diagram selection to react to, so none
 * of the pathway browser's data state either.
 *
 * Deliberately not `Partial<FigureService>`. It was, and adding a method to the
 * real service therefore compiled cleanly and broke this page in the browser
 * with "figure.src is not a function" -- the whole point of substituting a class
 * for a token is that it answers everything asked of the token.
 */
@Injectable()
export class DetailFigureService implements Omit<FigureService, 'toggle'> {
  private general = inject(GeneralService);

  readonly expanded = signal<Figure | undefined>(undefined);

  toggle(figure: Figure) {
    this.expanded.update((prev) => (prev === figure ? undefined : figure));
  }

  src(figure: Figure) {
    return figureSrc(figure, this.general.version.value());
  }

  onOrigin(figure: Figure) {
    return figureOnOrigin(figure);
  }

  fallback(event: Event, figure: Figure) {
    figureFallback(event, figure);
  }
}

export const detailFigureProvider = {
  provide: FigureService,
  useClass: DetailFigureService,
};
