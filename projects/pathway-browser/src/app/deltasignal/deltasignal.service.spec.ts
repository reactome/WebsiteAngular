import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DeltaSignalService } from './deltasignal.service';
import { buildObservations } from './deltasignal.utils';
import type {
  DeltaSignalNetwork,
  DeltaSignalPinsResponse,
  DeltaSignalReadoutsResponse,
} from './deltasignal.model';

// A perturbation pins what /api/pins resolves — the protocol every DeltaSignal
// benchmark figure was measured under (deltasignal specs/140) — never "every
// node whose reactome_id matches", which is the retired protocol this
// replaced. These tests pin that: the pins call, its cache, the observations
// actually sent, and the honest refusals.
describe('DeltaSignalService pins', () => {
  let service: DeltaSignalService;
  let http: HttpTestingController;

  const network: DeltaSignalNetwork = {
    status: 'success',
    message: 'ok',
    network_id: 'pw:test',
    edges: [],
    pathways: [],
    nodes: [
      {
        uuid: 'root-a',
        name: 'ATM',
        reactome_id: 'R-HSA-1',
        entity_type: 'protein',
        baseline: 0.01,
        set_id: null,
      },
      {
        uuid: 'mid-a',
        name: 'ATM',
        reactome_id: 'R-HSA-1',
        entity_type: 'protein',
        baseline: 0.01,
        set_id: null,
      },
    ],
  };

  const pinsAnswer = (
    over: Partial<DeltaSignalPinsResponse['results'][0]> = {}
  ): DeltaSignalPinsResponse => ({
    status: 'success',
    protocol: { pin_scope: 'root_cycle', root_ignore: 'depletion' },
    results: [
      {
        id: 'R-HSA-1',
        pins: [{ uuid: 'root-a', name: 'ATM' }],
        basis: 'root',
        occurrences: 2,
        ...over,
      },
    ],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DeltaSignalService);
    http = TestBed.inject(HttpTestingController);
    service.pathway.set({ id: 'Test_R-HSA-9', stable_id: 'R-HSA-9', name: 'Test' });
    service.network.set(network);
  });

  afterEach(() => http.verify());

  // Let the service's own await chain reach its next HTTP call.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('resolves a selection through /api/pins and pins exactly the answer', async () => {
    const selecting = service.select('R-HSA-1');
    const request = http.expectOne('/api/pins');
    expect(request.request.body).toEqual({
      network_id: 'pw:test',
      queries: [{ id: 'R-HSA-1', stable_ids: ['R-HSA-1'] }],
    });
    request.flush(pinsAnswer());
    await selecting;

    expect(service.pinState().status).toBe('ready');
    expect(service.addPerturbation('R-HSA-1', 0)).toBe(true);
    // The solve will receive the ROOT copy only — never mid-a, although its
    // reactome_id matches the selection.
    expect(buildObservations(service.perturbations())).toEqual({ 'root-a': [0, 1] });
    expect(service.perturbations()[0].basis).toBe('root');
  });

  it('answers a re-selection from the cache without asking again', async () => {
    const selecting = service.select('R-HSA-1');
    http.expectOne('/api/pins').flush(pinsAnswer());
    await selecting;

    await service.select(null);
    await service.select('R-HSA-1');
    http.expectNone('/api/pins');
    expect(service.pinState().status).toBe('ready');
  });

  it('says "none" honestly and refuses to add', async () => {
    const selecting = service.select('R-HSA-1');
    http.expectOne('/api/pins').flush(pinsAnswer({ pins: [], basis: 'none' }));
    await selecting;

    expect(service.pinState().result?.basis).toBe('none');
    expect(service.addPerturbation('R-HSA-1', 0)).toBe(false);
    expect(service.perturbations()).toEqual([]);
  });

  it('never falls back to reactome_id matching when resolution fails', async () => {
    const selecting = service.select('R-HSA-1');
    http
      .expectOne('/api/pins')
      .flush({ status: 'error', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await selecting;

    expect(service.pinState().status).toBe('error');
    expect(service.addPerturbation('R-HSA-1', 0)).toBe(false);
  });

  it('re-parses and retries once when the server lost its network cache', async () => {
    const selecting = service.select('R-HSA-1');
    http.expectOne('/api/pins').flush(
      {
        status: 'error',
        message: 'Unknown network_id. The server cache is per-process; call /api/parse again.',
      },
      { status: 400, statusText: 'Bad Request' }
    );
    await settle();
    http.expectOne('/api/parse').flush({ ...network, network_id: 'pw:test' });
    await settle();
    http.expectOne('/api/pins').flush(pinsAnswer());
    await selecting;

    expect(service.pinState().status).toBe('ready');
    expect(service.pinState().result?.pins).toEqual([{ uuid: 'root-a', name: 'ATM' }]);
  });
});

// After a solve, every entity value comes from /api/readouts — the resolution
// and entity-mean the figures were measured under (deltasignal specs/141) —
// never a browser-side mean over matching node copies, and never a fallback
// to one when the endpoint fails.
describe('DeltaSignalService readouts', () => {
  let service: DeltaSignalService;
  let http: HttpTestingController;

  const network: DeltaSignalNetwork = {
    status: 'success',
    message: 'ok',
    network_id: 'pw:test',
    edges: [],
    pathways: [],
    nodes: [
      {
        uuid: 'root-a',
        name: 'ATM',
        reactome_id: 'R-HSA-1',
        entity_type: 'protein',
        baseline: 0.01,
        set_id: null,
      },
      {
        uuid: 'mid-a',
        name: 'ATM',
        reactome_id: 'R-HSA-1',
        entity_type: 'protein',
        baseline: 0.01,
        set_id: null,
      },
      {
        uuid: 'node-b',
        name: 'TP53',
        reactome_id: 'R-HSA-2',
        entity_type: 'protein',
        baseline: 0.01,
        set_id: null,
      },
    ],
  };

  const protocol = {
    ko_agg: 'mean_entity',
    total_readout: 'abundance_a3',
    baseline: 0.01,
    down_cutoff: 0.85,
    up_cutoff: 1.15,
  };

  const readoutsAnswer = (): DeltaSignalReadoutsResponse => ({
    status: 'success',
    protocol,
    missing_tables: [],
    malformed_tables: [],
    results: [
      {
        id: 'R-HSA-1',
        mode: 'forms',
        basis: 'direct',
        groups: [['root-a', 'mid-a']],
        pinned: ['root-a'],
        value: 0.005,
        fold: 0.5,
        call: 'down',
        railed: false,
      },
      {
        id: 'R-HSA-2',
        mode: 'forms',
        basis: 'direct',
        groups: [['node-b']],
        pinned: [],
        value: 0.02,
        fold: 2,
        call: 'up',
        railed: false,
      },
    ],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DeltaSignalService);
    http = TestBed.inject(HttpTestingController);
    service.pathway.set({ id: 'Test_R-HSA-9', stable_id: 'R-HSA-9', name: 'Test' });
    service.network.set(network);
    service.perturbations.set([
      {
        reactomeId: 'R-HSA-1',
        name: 'ATM',
        activity: 0,
        nodeUuids: ['root-a'],
        basis: 'root',
      },
    ]);
  });

  afterEach(() => http.verify());

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const solveAnswer = {
    status: 'success' as const,
    message: 'ok',
    node_activities: { 'root-a': 0, 'mid-a': 0.01, 'node-b': 0.02 },
    influence_scores: { 'mid-a': 0.4, 'node-b': 0.9 },
    converged: true,
    iterations: 3,
    solve_time: 0.1,
  };

  it('values entities through /api/readouts with the solve activities and pins', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    const request = http.expectOne('/api/readouts');
    expect(request.request.body).toEqual({
      network_id: 'pw:test',
      activities: solveAnswer.node_activities,
      pinned: ['root-a'],
      queries: [
        { id: 'R-HSA-1', stable_ids: ['R-HSA-1'] },
        { id: 'R-HSA-2', stable_ids: ['R-HSA-2'] },
      ],
    });
    request.flush(readoutsAnswer());
    await solving;

    const rows = service.readoutRows();
    expect(rows.map((row) => row.reactomeId)).toEqual(['R-HSA-2', 'R-HSA-1']);
    expect(rows[1]).toMatchObject({
      name: 'ATM',
      fold: 0.5,
      call: 'down',
      perturbed: true,
      influence: 0.4,
    });
    expect(rows[0]).toMatchObject({ fold: 2, call: 'up', perturbed: false });
  });

  it('states unavailability on failure instead of falling back to a browser mean', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    http
      .expectOne('/api/readouts')
      .flush({ status: 'error', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await solving;

    expect(service.status()).toBe('ready'); // the solve itself stands
    expect(service.readoutState().status).toBe('error');
    expect(service.readoutState().message).toBe('boom');
    expect(service.readoutRows()).toEqual([]);
  });

  it('asks for a selected entity missing from the batch (an expanded species)', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    http.expectOne('/api/readouts').flush(readoutsAnswer());
    await solving;

    const resolving = service.resolveSelectedReadout('R-HSA-3');
    const request = http.expectOne('/api/readouts');
    const body = request.request.body as { queries: unknown };
    expect(body.queries).toEqual([{ id: 'R-HSA-3', stable_ids: ['R-HSA-3'] }]);
    request.flush({
      status: 'success',
      protocol,
      missing_tables: [],
      malformed_tables: [],
      results: [
        {
          id: 'R-HSA-3',
          mode: 'forms',
          basis: 'proxy',
          groups: [['reaction-r']],
          pinned: [],
          value: 0.03,
          fold: 3,
          call: 'up',
        },
      ],
    });
    await resolving;

    expect(service.readoutState().byId.get('R-HSA-3')).toMatchObject({ basis: 'proxy', fold: 3 });
    // an id already in the batch is never re-fetched
    await service.resolveSelectedReadout('R-HSA-1');
    http.expectNone('/api/readouts');
  });

  it('carries the served rail flag into rows and never computes it client-side', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    const answer = readoutsAnswer();
    // The engine says this readout sits at its stop; the row repeats that —
    // whatever the fold is. A client recomputing the test would be a second
    // protocol (deltasignal specs/142).
    answer.results[0] = { ...answer.results[0], fold: 0.5, railed: true };
    http.expectOne('/api/readouts').flush(answer);
    await solving;

    const byId = new Map(service.readoutRows().map((row) => [row.reactomeId, row]));
    expect(byId.get('R-HSA-1')?.railed).toBe(true);
    expect(byId.get('R-HSA-2')?.railed).toBe(false);
  });

  it('loads the scope statement once, honestly failing with nothing substituted', async () => {
    const scopeAnswer = {
      status: 'success',
      statement: {
        version: '2026-11-06',
        provenance_build: 'build-x',
        summary: ['What this is.'],
        validated: [],
        limitations: [],
        protocols: [],
      },
      served_catalog: 'build-y',
      measured_on_served_catalog: false,
    };
    const loading = service.loadScope();
    http.expectOne('/api/scope').flush(scopeAnswer);
    await loading;
    expect(service.scopeState().status).toBe('ready');
    expect(service.scopeState().scope?.measured_on_served_catalog).toBe(false);
    expect(service.scopeState().scope?.statement.provenance_build).toBe('build-x');

    // a second open never re-fetches
    await service.loadScope();
    http.expectNone('/api/scope');
  });

  it('reports an unavailable scope statement instead of substituting one', async () => {
    const loading = service.loadScope();
    http
      .expectOne('/api/scope')
      .flush({ message: 'down' }, { status: 500, statusText: 'Server Error' });
    await loading;
    expect(service.scopeState().status).toBe('error');
    expect(service.scopeState().scope).toBeNull();
  });

  it('drops an on-demand readout that a newer solve overtook in flight', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    http.expectOne('/api/readouts').flush(readoutsAnswer());
    await solving;

    const resolving = service.resolveSelectedReadout('R-HSA-3');
    const request = http.expectOne('/api/readouts');
    // a newer solve lands while the single query is in flight
    service.result.set({ ...solveAnswer, node_activities: { 'root-a': 0.01 } });
    request.flush({
      status: 'success',
      protocol,
      missing_tables: [],
      malformed_tables: [],
      results: [
        {
          id: 'R-HSA-3',
          mode: 'forms',
          basis: 'proxy',
          groups: [['reaction-r']],
          pinned: [],
          value: 0.03,
          fold: 3,
          call: 'up',
        },
      ],
    });
    await resolving;

    // the stale fold, computed from the old solve's activities, is never merged
    expect(service.readoutState().byId.has('R-HSA-3')).toBe(false);
  });
});
