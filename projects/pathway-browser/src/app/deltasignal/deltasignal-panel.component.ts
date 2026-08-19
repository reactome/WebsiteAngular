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

@Component({
  selector: 'cr-deltasignal-panel',
  templateUrl: './deltasignal-panel.component.html',
  styleUrl: './deltasignal-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatButton, MatIconButton, MatIcon, MatProgressSpinner, MatTooltip],
})
export class DeltaSignalPanelComponent {
  readonly service = inject(DeltaSignalService);

  readonly pathwayId = input.required<string>();
  readonly selectedStId = input<string | null>(null);
  readonly status = input.required<'open' | 'closed'>();
  readonly dismissed = output<void>();

  readonly activity = signal(0);
  readonly selectedNodes = computed(() => this.service.matchingNodes(this.selectedStId()));
  readonly selectedName = computed(() =>
    [...new Set(this.selectedNodes().map((node) => node.name))].join(' / ')
  );
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
