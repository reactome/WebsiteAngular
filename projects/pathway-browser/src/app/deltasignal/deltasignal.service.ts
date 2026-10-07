import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import chroma from 'chroma-js';
import {
  DeltaSignalNetwork,
  DeltaSignalPathway,
  DeltaSignalPerturbation,
  DeltaSignalSolveResult,
  DeltaSignalStatus,
} from './deltasignal.model';
import {
  aggregateRowsByReactomeId,
  buildObservations,
  groupChangesByReactomeId,
  resultRows,
} from './deltasignal.utils';

@Injectable({ providedIn: 'root' })
export class DeltaSignalService {
  private readonly http = inject(HttpClient);
  private catalogRequest?: Promise<DeltaSignalPathway[]>;
  private loadGeneration = 0;

  readonly status = signal<DeltaSignalStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly pathway = signal<DeltaSignalPathway | null>(null);
  readonly network = signal<DeltaSignalNetwork | null>(null);
  readonly perturbations = signal<DeltaSignalPerturbation[]>([]);
  readonly result = signal<DeltaSignalSolveResult | null>(null);

  readonly rows = computed(() => resultRows(this.network(), this.result(), this.perturbations()));
  readonly entityRows = computed(() => aggregateRowsByReactomeId(this.rows()));
  readonly overlay = computed(() => groupChangesByReactomeId(this.rows()));
  readonly hasOverlay = computed(() => this.overlay().size > 0);
  readonly maxAbsoluteChange = computed(() =>
    Math.max(1, ...this.rows().map((row) => Math.abs(row.change)))
  );
  readonly palette = computed(() => {
    const extent = this.maxAbsoluteChange();
    return chroma
      .scale(['#a23b72', '#f4f1ed', '#1b7f8c'])
      .mode('oklab')
      .domain([-extent, 0, extent]);
  });

  matchingNodes(reactomeId: string | null | undefined) {
    if (!reactomeId) return [];
    return this.network()?.nodes.filter((node) => node.reactome_id === reactomeId) ?? [];
  }

  async loadPathway(stableId: string): Promise<void> {
    if (this.pathway()?.stable_id === stableId && this.network()) return;

    const generation = ++this.loadGeneration;
    this.status.set('loading');
    this.error.set(null);
    this.pathway.set(null);
    this.network.set(null);
    this.perturbations.set([]);
    this.result.set(null);

    try {
      const catalog = await this.getCatalog();
      if (generation !== this.loadGeneration) return;

      const pathway = catalog.find((candidate) => candidate.stable_id === stableId);
      if (!pathway) {
        this.status.set('error');
        this.error.set(`DeltaSignal does not yet have a generated network for ${stableId}.`);
        return;
      }

      const network = await this.parse(pathway);
      if (generation !== this.loadGeneration) return;
      this.pathway.set(pathway);
      this.network.set(network);
      this.status.set('ready');
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.status.set('error');
      this.error.set(this.errorMessage(error, 'Could not load the DeltaSignal network.'));
    }
  }

  addPerturbation(reactomeId: string, activity: number): boolean {
    const nodes = this.matchingNodes(reactomeId);
    if (!nodes.length) return false;

    const boundedActivity = Math.min(100, Math.max(0, activity));
    const perturbation: DeltaSignalPerturbation = {
      reactomeId,
      name: [...new Set(nodes.map((node) => node.name))].join(' / '),
      activity: boundedActivity,
      nodeUuids: nodes.map((node) => node.uuid),
    };
    this.perturbations.update((items) => [
      ...items.filter((item) => item.reactomeId !== reactomeId),
      perturbation,
    ]);
    this.result.set(null);
    return true;
  }

  removePerturbation(reactomeId: string) {
    this.perturbations.update((items) => items.filter((item) => item.reactomeId !== reactomeId));
    this.result.set(null);
  }

  clear() {
    this.perturbations.set([]);
    this.result.set(null);
    this.error.set(null);
  }

  clearResult() {
    this.result.set(null);
  }

  reset() {
    this.loadGeneration += 1;
    this.status.set('idle');
    this.error.set(null);
    this.pathway.set(null);
    this.network.set(null);
    this.perturbations.set([]);
    this.result.set(null);
  }

  async solve(): Promise<void> {
    const network = this.network();
    const pathway = this.pathway();
    if (!network || !pathway || !this.perturbations().length) return;

    this.status.set('solving');
    this.error.set(null);
    const observations = buildObservations(this.perturbations());

    try {
      this.result.set(await this.requestSolve(network.network_id, observations));
      this.status.set('ready');
    } catch (error) {
      let solveError = error;
      if (error instanceof HttpErrorResponse && error.status === 404) {
        try {
          const reparsed = await this.parse(pathway);
          this.network.set(reparsed);
          this.result.set(await this.requestSolve(reparsed.network_id, observations));
          this.status.set('ready');
          return;
        } catch (retryError) {
          solveError = retryError;
        }
      }
      this.status.set('error');
      this.error.set(
        this.errorMessage(solveError, 'DeltaSignal could not solve this perturbation.')
      );
    }
  }

  private getCatalog() {
    this.catalogRequest ??= firstValueFrom(
      this.http.get<DeltaSignalPathway[]>('/api/pathways')
    ).catch((error) => {
      this.catalogRequest = undefined;
      throw error;
    });
    return this.catalogRequest;
  }

  private parse(pathway: DeltaSignalPathway) {
    return firstValueFrom(
      this.http.post<DeltaSignalNetwork>('/api/parse', { pathway_id: pathway.id })
    );
  }

  private requestSolve(networkId: string, observations: Record<string, [number, number]>) {
    return firstValueFrom(
      this.http.post<DeltaSignalSolveResult>('/api/solve', {
        network_id: networkId,
        observations,
      })
    );
  }

  private errorMessage(error: unknown, fallback: string) {
    if (error instanceof HttpErrorResponse) {
      return typeof error.error?.message === 'string' ? error.error.message : fallback;
    }
    return error instanceof Error ? error.message : fallback;
  }
}
