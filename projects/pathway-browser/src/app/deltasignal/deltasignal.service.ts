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
  DeltaSignalReadoutRow,
  DeltaSignalReadoutsResponse,
  DeltaSignalReadoutState,
  DeltaSignalScopeResponse,
  DeltaSignalScopeState,
  ContentServiceEntity,
  DeltaSignalSolveResult,
  DeltaSignalStatus,
} from './deltasignal.model';
import { buildObservations, groupChangesByReactomeId, resultRows } from './deltasignal.utils';
import { CONTENT_SERVICE } from '../../environments/environment';

// specs/020: the member closure may take one ContentService request per set
// node in the tree. Past this many, member resolution is abandoned entirely:
// a partial closure is a different protocol than the bench's, so it is never
// sent.
const MEMBER_FETCH_CAP = 12;

const IDLE_READOUTS: DeltaSignalReadoutState = {
  status: 'idle',
  byId: new Map(),
  protocol: null,
  message: null,
};

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

  readonly readoutState = signal<DeltaSignalReadoutState>(IDLE_READOUTS);

  /**
   * The served scope statement (deltasignal specs/143): what the system is
   * validated for, with provenance. Fetched once per session on first open;
   * on failure the view says it is unavailable — no local copy ever
   * substitutes, because the engine's versioned file is the single source.
   */
  readonly scopeState = signal<DeltaSignalScopeState>({ status: 'idle', scope: null });

  readonly rows = computed(() => resultRows(this.network(), this.result(), this.perturbations()));
  /**
   * One row per Reactome entity, valued by `/api/readouts` — the resolution
   * and entity-mean every benchmark figure was measured under (deltasignal
   * specs/141). Never a browser-side mean over matching node copies: that is
   * the retired display rule this replaces.
   */
  readonly readoutRows = computed<DeltaSignalReadoutRow[]>(() => {
    const network = this.network();
    const state = this.readoutState();
    const influence = this.result()?.influence_scores ?? {};
    if (!network || state.status !== 'ready') return [];
    const nodeByUuid = new Map(network.nodes.map((node) => [node.uuid, node]));
    const rows: DeltaSignalReadoutRow[] = [];
    for (const [reactomeId, readout] of state.byId) {
      if (readout.basis === 'none') continue;
      if (readout.fold === null || readout.fold === undefined) continue;
      if (readout.call === null || readout.call === undefined) continue;
      const uuids = readout.groups.flat();
      const names = [
        ...new Set(uuids.map((uuid) => nodeByUuid.get(uuid)?.name).filter((n) => !!n)),
      ] as string[];
      rows.push({
        reactomeId,
        name: names.length ? names.join(' / ') : reactomeId,
        basis: readout.basis,
        fold: readout.fold,
        call: readout.call,
        railed: readout.railed === true,
        influence: Math.max(0, ...uuids.map((uuid) => influence[uuid] ?? 0)),
        perturbed: readout.pinned.length > 0,
      });
    }
    const departure = (fold: number) => Math.abs(Math.log(Math.max(fold, 1e-6)));
    return rows.sort((a, b) => departure(b.fold) - departure(a.fold) || b.influence - a.influence);
  });
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
    this.readoutState.set(IDLE_READOUTS);

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
    this.readoutState.set(IDLE_READOUTS);
    return true;
  }

  removePerturbation(reactomeId: string) {
    this.perturbations.update((items) => items.filter((item) => item.reactomeId !== reactomeId));
    this.result.set(null);
    this.readoutState.set(IDLE_READOUTS);
  }

  clear() {
    this.perturbations.set([]);
    this.result.set(null);
    this.readoutState.set(IDLE_READOUTS);
    this.error.set(null);
  }

  clearResult() {
    this.result.set(null);
    this.readoutState.set(IDLE_READOUTS);
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
    this.readoutState.set(IDLE_READOUTS);
  }

  async solve(): Promise<void> {
    const network = this.network();
    const pathway = this.pathway();
    if (!network || !pathway || !this.perturbations().length) return;

    this.status.set('solving');
    this.error.set(null);
    this.readoutState.set(IDLE_READOUTS);
    const observations = buildObservations(this.perturbations());

    try {
      this.result.set(await this.requestSolve(network.network_id, observations));
      this.status.set('ready');
      await this.resolveReadouts(network.network_id, observations);
    } catch (error) {
      let solveError = error;
      if (error instanceof HttpErrorResponse && error.status === 404) {
        try {
          const reparsed = await this.parse(pathway);
          this.network.set(reparsed);
          this.result.set(await this.requestSolve(reparsed.network_id, observations));
          this.status.set('ready');
          await this.resolveReadouts(reparsed.network_id, observations);
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

  /**
   * Value every entity of the solved network through `/api/readouts` — one
   * batch request carrying the solve's activities verbatim and the pinned
   * uuids. On failure the table is UNAVAILABLE, stated as such: there is no
   * browser-side aggregation to fall back to, because no published figure
   * applies to such numbers.
   */
  private async resolveReadouts(
    networkId: string,
    observations: Record<string, [number, number]>
  ): Promise<void> {
    const network = this.network();
    const activities = this.result()?.node_activities;
    if (!network || !activities) return;
    const ids = [...new Set(network.nodes.map((node) => node.reactome_id).filter((id) => !!id))];
    this.membersTried.clear(); // a new solve may resolve differently (specs/020)
    this.readoutState.set({ ...IDLE_READOUTS, status: 'loading' });
    try {
      const response = await this.requestReadouts(networkId, ids, activities, observations);
      if (this.result()?.node_activities !== activities) return; // a newer solve took over
      this.readoutState.set({
        status: 'ready',
        byId: new Map(
          response.results.flatMap((entry) =>
            entry.id === null ? [] : [[entry.id, entry] as const]
          )
        ),
        protocol: response.protocol,
        message: null,
      });
    } catch (error) {
      if (this.result()?.node_activities !== activities) return;
      this.readoutState.set({
        ...IDLE_READOUTS,
        status: 'error',
        message: this.errorMessage(error, 'The measured readout protocol is unavailable.'),
      });
    }
  }

  /**
   * A selected entity that was not among the network's node ids (a curated
   * species the generator expanded into variants resolves through its proxy
   * reactions; deltasignal specs/141) is asked for on demand and merged into
   * the batch.
   */
  async resolveSelectedReadout(reactomeId: string | null): Promise<void> {
    const network = this.network();
    const state = this.readoutState();
    const activities = this.result()?.node_activities;
    if (!reactomeId || !network || !activities || state.status !== 'ready') return;
    const cached = state.byId.get(reactomeId);
    if (cached && cached.basis !== 'none') return;
    if (cached && this.membersTried.has(reactomeId)) return;
    const observations = buildObservations(this.perturbations());
    try {
      let entry = cached ?? null;
      if (!entry) {
        const response = await this.requestReadouts(
          network.network_id,
          [reactomeId],
          activities,
          observations
        );
        entry = response.results[0] ?? null;
      }
      // specs/020: an entity nothing resolved may be a curated set, which the
      // measured ladder reads through its member species — the bench got the
      // member closure from Neo4j; the browser gets the same closure from the
      // ContentService. Tried at most once per entity per solve.
      if (entry?.basis === 'none' && !this.membersTried.has(reactomeId)) {
        this.membersTried.add(reactomeId);
        const members = await this.fetchMemberClosure(reactomeId);
        if (members && members.length > 0) {
          const response = await firstValueFrom(
            this.http.post<DeltaSignalReadoutsResponse>('/api/readouts', {
              network_id: network.network_id,
              activities,
              pinned: Object.keys(observations),
              queries: [{ id: reactomeId, stable_ids: [reactomeId], members }],
            })
          );
          entry = response.results[0] ?? entry;
        }
      }
      if (this.result()?.node_activities !== activities) return; // a newer solve took over
      const current = this.readoutState();
      if (!entry || current.status !== 'ready') return;
      const existing = current.byId.get(reactomeId);
      if (existing && existing.basis !== 'none') return;
      this.readoutState.set({
        ...current,
        byId: new Map([...current.byId, [reactomeId, entry]]),
      });
    } catch {
      // The batch stays valid; the selection block simply has no readout.
    }
  }

  // Entities whose member resolution already ran this solve (specs/020 FR-002).
  private membersTried = new Set<string>();

  /**
   * The bench's set-member closure (neo4j_set_member_stids: every node over
   * hasMember|hasCandidate, every level, distinct), walked through the
   * ContentService. Only set-classed members are fetched further — in
   * Reactome only an EntitySet carries those relationships, so the class test
   * is the edge-presence test. Returns null when the entity is not a set,
   * when the service fails, or when the walk would exceed the fetch cap —
   * never a partial closure.
   */
  private async fetchMemberClosure(reactomeId: string): Promise<string[] | null> {
    const members: string[] = [];
    const seen = new Set<string>([reactomeId]);
    const queue = [reactomeId];
    let fetches = 0;
    let isSet = false;
    while (queue.length > 0) {
      if (fetches >= MEMBER_FETCH_CAP) return null; // abandon, never truncate
      const stId = queue.shift();
      if (stId === undefined) break;
      fetches += 1;
      let entity: ContentServiceEntity;
      try {
        entity = await firstValueFrom(
          this.http.get<ContentServiceEntity>(`${CONTENT_SERVICE}/data/query/enhanced/${stId}`)
        );
      } catch {
        return null;
      }
      const children = [...(entity.hasMember ?? []), ...(entity.hasCandidate ?? [])];
      if (stId === reactomeId && children.length === 0) return null; // not a set
      if (stId === reactomeId) isSet = true;
      for (const child of children) {
        if (!child.stId || seen.has(child.stId)) continue;
        seen.add(child.stId);
        members.push(child.stId);
        if (child.schemaClass?.includes('Set')) queue.push(child.stId);
      }
    }
    return isSet ? members : null;
  }

  async loadScope(): Promise<void> {
    const current = this.scopeState();
    if (current.status === 'ready' || current.status === 'loading') return;
    this.scopeState.set({ status: 'loading', scope: null });
    try {
      const scope = await firstValueFrom(this.http.get<DeltaSignalScopeResponse>('/api/scope'));
      this.scopeState.set({ status: 'ready', scope });
    } catch {
      this.scopeState.set({ status: 'error', scope: null });
    }
  }

  private requestReadouts(
    networkId: string,
    ids: string[],
    activities: Record<string, number>,
    observations: Record<string, [number, number]>
  ) {
    return firstValueFrom(
      this.http.post<DeltaSignalReadoutsResponse>('/api/readouts', {
        network_id: networkId,
        activities,
        pinned: Object.keys(observations),
        queries: ids.map((id) => ({ id, stable_ids: [id] })),
      })
    );
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
