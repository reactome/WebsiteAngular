import { Injectable, signal } from '@angular/core';
import { FigureService } from '../../../../../../pathway-browser/src/app/details/tabs/description-tab/figure/figure.service';
import { Figure } from '../../../../../../pathway-browser/src/app/model/graph/figure.model';

@Injectable()
export class DetailFigureService implements Partial<FigureService> {
  readonly expanded = signal<Figure | undefined>(undefined);

  toggle(figure: Figure) {
    this.expanded.update((prev) => (prev === figure ? undefined : figure));
  }
}

export const detailFigureProvider = {
  provide: FigureService,
  useClass: DetailFigureService,
};
