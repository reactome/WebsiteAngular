import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { DeltaSignalService } from './deltasignal.service';
import { DeltaSignalLogicGraphComponent } from './deltasignal-logic-graph.component';

@Component({
  selector: 'cr-deltasignal-panel',
  templateUrl: './deltasignal-panel.component.html',
  styleUrl: './deltasignal-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    DeltaSignalLogicGraphComponent,
    MatButton,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    MatTooltip,
  ],
})
export class DeltaSignalPanelComponent {
  readonly service = inject(DeltaSignalService);

  readonly pathwayId = input.required<string>();
  readonly selectedStId = input<string | null>(null);
  readonly status = input.required<'open' | 'closed'>();
  readonly dismissed = output<void>();

  readonly activity = signal(0);
  readonly resultView = signal<'diagram' | 'logic'>('diagram');
  readonly selectedNodes = computed(() => this.service.matchingNodes(this.selectedStId()));
  // The selection's resolution through /api/pins (deltasignal specs/140): the
  // nodes a perturbation here will pin — the protocol every benchmark figure
  // was measured under — or the honest "none".
  readonly selectedPins = computed(() => {
    const state = this.service.pinState();
    return state.status === 'ready' && state.reactomeId === this.selectedStId()
      ? state.result
      : null;
  });
  readonly pinsLoading = computed(() => {
    const state = this.service.pinState();
    return state.status === 'loading' && state.reactomeId === this.selectedStId();
  });
  readonly pinsError = computed(() => {
    const state = this.service.pinState();
    return state.status === 'error' && state.reactomeId === this.selectedStId()
      ? (state.message ?? 'Could not resolve what this perturbation would pin.')
      : null;
  });
  readonly canAdd = computed(() => (this.selectedPins()?.pins.length ?? 0) > 0);
  readonly selectedName = computed(() => {
    const pins = this.selectedPins();
    const names = pins?.pins.length
      ? pins.pins.map((pin) => pin.name)
      : this.selectedNodes().map((node) => node.name);
    return [...new Set(names)].join(' / ');
  });
  readonly visibleRows = computed(() => this.service.entityRows().slice(0, 40));

  constructor() {
    effect(() => {
      const pathwayId = this.pathwayId();
      const loadedPathway = this.service.pathway();
      if (loadedPathway && loadedPathway.stable_id !== pathwayId) this.service.reset();
    });
    effect(() => {
      if (this.status() === 'open') void this.service.loadPathway(this.pathwayId());
    });
    effect(() => {
      // Re-resolve when the selection changes AND when the network arrives:
      // reading network() here is what re-runs this once loading finishes.
      const stableId = this.selectedStId();
      const ready = this.service.network() !== null;
      void this.service.select(ready ? stableId : null);
    });
  }

  setActivity(value: string | number) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) this.activity.set(Math.min(100, Math.max(0, parsed)));
  }

  addSelected() {
    const stableId = this.selectedStId();
    if (stableId) this.service.addPerturbation(stableId, this.activity());
  }
}
