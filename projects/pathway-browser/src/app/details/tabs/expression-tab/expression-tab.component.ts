import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { CONTENT_SERVICE } from '../../../../environments/environment';
import type { ExpressionAnswer, ExpressionNotShown } from '../../../model/expression.model';
import { SelectableObject } from '../../../services/event.service';
import { ExpressionHeatmapComponent } from './expression-heatmap/expression-heatmap.component';

/** Why a gene has no row, in words (FR-007). */
const REASONS: Record<ExpressionNotShown['reason'], string> = {
  'no-gene': 'no matching gene',
  'not-in-experiment': 'not in this experiment',
  'not-measured': 'not measured',
  'other-species': 'another species',
};

/**
 * The Expression tab (spec 024): a heatmap of the selection's own genes across
 * the tissues of its species' experiment, from the content service's
 * /expression/{id}. It embedded Expression Atlas's widget, which ignores the
 * genes it is asked about: every pathway showed the same 29 marker genes, one
 * per tissue, none of them the pathway's.
 */
@Component({
  selector: 'cr-expression-tab',
  templateUrl: './expression-tab.component.html',
  styleUrl: './expression-tab.component.scss',
  imports: [ExpressionHeatmapComponent],
})
export class ExpressionTabComponent {
  private readonly http = inject(HttpClient);

  readonly obj = input.required<SelectableObject>();

  readonly expression = rxResource({
    params: () => this.obj().stId,
    stream: ({ params }) =>
      this.http.get<ExpressionAnswer>(
        `${CONTENT_SERVICE}/expression/${encodeURIComponent(params)}`
      ),
  });

  /** The answer, or nothing while it loads or when it failed. */
  readonly answer = computed(() =>
    this.expression.hasValue() && !this.expression.isLoading() ? this.expression.value() : undefined
  );
  readonly experiment = computed(() => {
    const answer = this.answer();
    return answer && answer.kind !== 'species-not-available' ? answer.experiment : undefined;
  });

  reason(notShown: ExpressionNotShown): string {
    return REASONS[notShown.reason];
  }
}
