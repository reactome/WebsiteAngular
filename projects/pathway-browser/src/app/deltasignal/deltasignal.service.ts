import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import chroma from 'chroma-js';
import {
  DeltaSignalNetwork,
  DeltaSignalPathway,
  DeltaSignalPerturbation,
  DeltaSignalPinResult,
  DeltaSignalPinsResponse,
  DeltaSignalPinState,
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
  private catalogRequest: Promise<DeltaSignalPathway[]> | undefined;
  private loadGeneration = 0;
  private pinGeneration = 0;
  // Resolved pins per `${network_id}:${stable id}` — the network_id in the
  // key keeps one build's answer off another build's network.
  private readonly pinCache = new Map<string, DeltaSignalPinResult>();

  readonly status = signal<DeltaSignalStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly pathway = signal<DeltaSignalPathway | null>(null);
  readonly network = signal<DeltaSignalNetwork | null>(null);
  readonly perturbations = signal<DeltaSignalPerturbation[]>([]);
  readonly result = signal<DeltaSignalSolveResult | null>(null);
  readonly pinState = signal<DeltaSignalPinState>({
    status: 'idle',
    reactomeId: null,
    result: null,
    message: null,
  });

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
    this.pinGeneration += 1;
    this.status.set('loading');
    this.error.set(null);
    this.pathway.set(null);
    this.network.set(null);
    this.perturbations.set([]);
    this.result.set(null);
    this.pinState.set({ status: 'idle', reactomeId: null, result: null, message: null });

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

  /**
   * Resolve the selected entity through `/api/pins` — the protocol every
   * DeltaSignal benchmark ran (deltasignal specs/140). Cached per network and
   * entity; `pinState` carries the answer for the panel.
   */
  async select(reactomeId: string | null): Promise<void> {
    const generation = ++this.pinGeneration;
    const network = this.network();
    const pathway = this.pathway();
    if (!reactomeId || !network || !pathway) {
      this.pinState.set({ status: 'idle', reactomeId, result: null, message: null });
      return;
    }
    const cached = this.pinCache.get(`${network.network_id}:${reactomeId}`);
    if (cached) {
      this.pinState.set({ status: 'ready', reactomeId, result: cached, message: null });
      return;
    }
    this.pinState.set({ status: 'loading', reactomeId, result: null, message: null });
    try {
      const result = await this.resolvePins(network, pathway, reactomeId);
      this.pinCache.set(`${this.network()?.network_id}:${reactomeId}`, result);
      if (generation !== this.pinGeneration) return;
      this.pinState.set({ status: 'ready', reactomeId, result, message: null });
    } catch (error) {
      if (generation !== this.pinGeneration) return;
      // No fallback to pinning every matching node: that is the retired
      // protocol this endpoint replaces, and no published figure applies to
      // its answers.
      this.pinState.set({
        status: 'error',
        reactomeId,
        result: null,
        message: this.errorMessage(error, 'Could not resolve what this perturbation would pin.'),
      });
    }
  }

  addPerturbation(reactomeId: string, activity: number): boolean {
    const network = this.network();
    const resolved = network ? this.pinCache.get(`${network.network_id}:${reactomeId}`) : undefined;
    if (!resolved?.pins.length) return false;

    const boundedActivity = Math.min(100, Math.max(0, activity));
    const perturbation: DeltaSignalPerturbation = {
      reactomeId,
      name: [...new Set(resolved.pins.map((pin) => pin.name))].join(' / '),
      activity: boundedActivity,
      nodeUuids: resolved.pins.map((pin) => pin.uuid),
      basis: resolved.basis,
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
    this.pinGeneration += 1;
    this.status.set('idle');
    this.error.set(null);
    this.pathway.set(null);
    this.network.set(null);
    this.perturbations.set([]);
    this.result.set(null);
    this.pinState.set({ status: 'idle', reactomeId: null, result: null, message: null });
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

  /**
   * One `/api/pins` query, with the solve path's recovery: on a failure that
   * can mean "the server restarted and lost its network cache", re-parse and
   * ask once more against the fresh network_id.
   */
  private async resolvePins(
    network: DeltaSignalNetwork,
    pathway: DeltaSignalPathway,
    reactomeId: string
  ): Promise<DeltaSignalPinResult> {
    try {
      return await this.requestPins(network.network_id, reactomeId);
    } catch (error) {
      if (!this.lostNetworkCache(error)) throw error;
      const reparsed = await this.parse(pathway);
      this.network.set(reparsed);
      return this.requestPins(reparsed.network_id, reactomeId);
    }
  }

  private async requestPins(networkId: string, reactomeId: string): Promise<DeltaSignalPinResult> {
    const response = await firstValueFrom(
      this.http.post<DeltaSignalPinsResponse>('/api/pins', {
        network_id: networkId,
        queries: [{ id: reactomeId, stable_ids: [reactomeId] }],
      })
    );
    const result = response.results[0];
    if (!result) throw new Error('The pin service answered without a result.');
    return result;
  }

  private requestSolve(networkId: string, observations: Record<string, [number, number]>) {
    return firstValueFrom(
      this.http.post<DeltaSignalSolveResult>('/api/solve', {
        network_id: networkId,
        observations,
      })
    );
  }

  /** The failure that means "re-parse and retry", as the solve path handles it. */
  private lostNetworkCache(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) return false;
    if (error.status === 404) return true;
    const body: unknown = error.error;
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message?: unknown }).message
        : null;
    return error.status === 400 && typeof message === 'string' && message.includes('network_id');
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      return typeof error.error?.message === 'string' ? error.error.message : fallback;
    }
    return error instanceof Error ? error.message : fallback;
  }
}
