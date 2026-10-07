import { Component, computed, input, inject } from '@angular/core';
import { AnalysisService } from '../../../../services/analysis.service';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';
import { ScientificNumberPipe } from '../../../../pipes/scientific-number.pipe';
import { UrlStateService } from '../../../../services/url-state.service';
import { DarkService } from '../../../../services/dark.service';

type Label = { text: string; tooltip: string };

export const gsaValueToLabel = new Map<number, Label>([
  [2, { text: 'keyboard_double_arrow_up', tooltip: 'Significantly up regulated' }],
  [1, { text: 'keyboard_arrow_up', tooltip: 'Non-significantly up regulated' }],
  [0, { text: 'remove', tooltip: 'No regulation' }],
  [-1, { text: 'keyboard_arrow_down', tooltip: 'Non-significantly down regulated' }],
  [-2, { text: 'keyboard_double_arrow_down', tooltip: 'Significantly down regulated' }],
]);

@Component({
  selector: 'cr-expression-tag',
  imports: [MatTooltip, MatIcon, DecimalPipe, ScientificNumberPipe],
  templateUrl: './expression-tag.component.html',
  styleUrl: './expression-tag.component.scss',
})
export class ExpressionTagComponent {
  private analysis = inject(AnalysisService);
  private state = inject(UrlStateService);
  private dark = inject(DarkService);

  readonly value = input.required<number>();
  readonly scientificFormat = input.required<boolean>();

  readonly fdr = input<number>(0);
  readonly isFDR = input<boolean>(false);
  readonly isSignificant = computed(
    () => ((this.isFDR() && this.value()) || this.fdr()) <= this.state.significance()
  );

  readonly isRegulation = input<boolean>(false);

  readonly format = input<string | undefined>('1.3-3');

  readonly palette = computed(() =>
    this.isFDR() && this.analysis.type() !== 'OVERREPRESENTATION'
      ? this.analysis.fdrPalette()
      : this.analysis.palette()
  );
  readonly scale = computed(() => {
    this.dark.isDark(); // Update on dark change
    return this.palette().scale;
  });
  readonly color = computed(() => this.scale()(this.value()));
  readonly onColor = computed(() => (this.color().get('oklch.l') > 0.7 ? 'black' : 'white'));
  readonly style = computed(() =>
    this.isSignificant()
      ? {
          background: this.color().hex(),
          color: this.onColor(),
        }
      : {
          background: 'var(--surface)',
          color: 'var(--on-surface)',
          border: `2px solid ${this.color().hex()}`,
        }
  );

  protected readonly gsaValueToLabel = gsaValueToLabel;
}
