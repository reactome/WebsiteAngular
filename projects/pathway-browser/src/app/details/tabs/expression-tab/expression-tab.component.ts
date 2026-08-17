import { Component, effect, input, inject } from '@angular/core';
import { EntityService } from '../../../services/entity.service';
import { SelectableObject } from '../../../services/event.service';

// Global variable avoid typescript errors
declare const expressionAtlasHeatmapHighcharts: any;

type GXAQuery = { value: string };

@Component({
  selector: 'cr-expression-tab',
  standalone: true,
  templateUrl: './expression-tab.component.html',
  styleUrl: './expression-tab.component.scss',
  imports: [],
})
export class ExpressionTabComponent {
  private entity = inject(EntityService);

  readonly obj = input.required<SelectableObject>();
  gxaQueries: GXAQuery[] | null = null;

  constructor() {
    effect(() => {
      const selectedEvent = this.obj().stId;
      this.entity.loadRefEntities(selectedEvent);
      const data = this.entity.refEntities();

      this.gxaQueries = Array.isArray(data)
        ? data.map((entity) => ({ value: entity.identifier }))
        : null;

      if (this.gxaQueries) {
        expressionAtlasHeatmapHighcharts.render({
          target: 'expressionContainer',
          experiment: 'reference',
          query: {
            // species: 'homo sapiens',
            gene: this.gxaQueries,
          },
        });
      }
    });
  }
}
