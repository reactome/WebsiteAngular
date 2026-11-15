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
import { DecimalPipe, PercentPipe } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { DeltaSignalService } from './deltasignal.service';
import { DeltaSignalReadoutRow } from './deltasignal.model';
import { buildSoftObservations } from './deltasignal.utils';
import { DeltaSignalLogicGraphComponent } from './deltasignal-logic-graph.component';

@Component({
  selector: 'cr-deltasignal-panel',
  templateUrl: './deltasignal-panel.component.html',
  styleUrl: './deltasignal-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    PercentPipe,
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
  // A measured level for the selected, solved readout (deltasignal specs/156).
  // Weight 0.5 is the default because it was the strongest registered weight
  // on the engine's record (specs/156 FR-004).
  readonly measuredFold = signal(1);
  readonly measuredWeight = signal(0.5);
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
  readonly visibleRows = computed(() => this.service.readoutRows().slice(0, 40));
  // specs/027: the compact rendering of a served measured range (deltasignal
  // specs/155) — the 50%-share entries only, one line per axis. The axis
  // names are display labels; an unknown axis shows its served name.
  rowRanges(row: DeltaSignalReadoutRow) {
    return row.ranges.filter((range) => range.share === 0.5);
  }
  axisLabel(axis: string): string {
    return (
      { korkut_rppa: 'the drug-RPPA record', decryptm_phospho: 'the drug-phospho record' }[axis] ??
      axis
    );
  }
  // The selection's readout through /api/readouts (deltasignal specs/141):
  // its measured predicted level, even when the entity has no node of its own
  // (it then reads through its proxy reactions), or null while none exists.
  readonly selectedReadout = computed(() => {
    const id = this.selectedStId();
    const state = this.service.readoutState();
    return id && state.status === 'ready' ? (state.byId.get(id) ?? null) : null;
  });

  // A measured level attaches only to a row resolved from entity nodes: a
  // proxy row's groups are reaction flux, not a level anyone measured.
  readonly canMeasure = computed(() => {
    const readout = this.selectedReadout();
    return (
      !!readout && !!readout.call && (readout.basis === 'direct' || readout.basis === 'set_members')
    );
  });
  /** How many node levels the next solve will send (shared nodes counted once). */
  readonly softSent = computed(
    () => Object.keys(buildSoftObservations(this.service.measurements())).length
  );
  readonly softLine = computed(() => {
    const result = this.service.result();
    if (!result) return null;
    if (result.soft_observed === undefined) {
      // A server from before deltasignal specs/156 ignores unknown request
      // fields: measurements were sent and silently dropped. Say so — the
      // engine's own 400 only exists on servers that know the field.
      return this.softSent()
        ? 'This server ignored the measured levels (it predates soft observations) — this answer is unconditioned.'
        : null;
    }
    if (!this.softSent() && !result.soft_observed) return null;
    const overridden = result.soft_overridden ?? [];
    const pins = overridden.filter((item) => item.reason === 'pin').length;
    const pools = overridden.filter((item) => item.reason === 'pool').length;
    const parts = [
      `Conditioned on ${result.soft_observed} of ${this.softSent()} measured node levels`,
    ];
    if (pins) parts.push(`${pins} overridden by a hard pin`);
    if (pools) parts.push(`${pools} written by a cycle pool instead`);
    if (result.soft_observed + pins + pools < this.softSent())
      parts.push('the rest were not in the solved network');
    return parts.join(' · ');
  });

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
    effect(() => {
      // A selected entity missing from the readout batch (an expanded species
      // with no node of its own) is asked for on demand once a solve exists.
      const stableId = this.selectedStId();
      if (this.service.readoutState().status === 'ready')
        void this.service.resolveSelectedReadout(stableId);
    });
  }

  onScopeToggle(event: Event) {
    // The scope statement is fetched the first time a user opens the view —
    // it is the engine's versioned record (deltasignal specs/143), never a
    // copy kept in this client.
    if ((event.target as HTMLDetailsElement).open) void this.service.loadScope();
  }

  setActivity(value: string | number) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) this.activity.set(Math.min(100, Math.max(0, parsed)));
  }

  addSelected() {
    const stableId = this.selectedStId();
    if (stableId) this.service.addPerturbation(stableId, this.activity());
  }

  setMeasuredFold(value: string | number) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) this.measuredFold.set(Math.min(100, Math.max(0, parsed)));
  }

  setMeasuredWeight(value: string | number) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) this.measuredWeight.set(Math.min(1, Math.max(0, parsed)));
  }

  addMeasurement() {
    const stableId = this.selectedStId();
    if (stableId) this.service.addMeasurement(stableId, this.measuredFold(), this.measuredWeight());
  }
}
