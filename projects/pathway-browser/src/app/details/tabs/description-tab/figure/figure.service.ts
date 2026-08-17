import { effect, Injectable, signal, inject } from '@angular/core';
import {Figure} from "../../../../model/graph/figure.model";
import {DataStateService} from "../../../../services/data-state.service";

@Injectable({
  providedIn: 'root'
})
export class FigureService {
  private data = inject(DataStateService);


  readonly expanded = signal<Figure | undefined>(undefined)

  toggle(figure: Figure) {
    this.expanded.update(prev => prev === figure ? undefined : figure);
  }


  constructor() {
    effect(() => {
      this.data.selectedElement() && this.expanded.set(undefined); // reset expanded when element changes
    });
  }
}
