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
      converged: true, // specs/146: the solve's flag sharpens the confidence strata
      pinned: ['root-a'],
      queries: [
        { id: 'R-HSA-1', stable_ids: ['R-HSA-1'] },
        { id: 'R-HSA-2', stable_ids: ['R-HSA-2'] },
      ],
    });
    request.flush(readoutsAnswer());
    await flushNoLeads();
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
    await flushNoLeads();
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
    await flushNoLeads();
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

  const noneEntry = (id: string) => ({
    status: 'success',
    protocol,
    missing_tables: [],
    malformed_tables: [],
    results: [{ id, mode: 'forms', basis: 'none', groups: [], pinned: [] }],
  });

  const enhancedUrl = (id: string) => (req: { url: string }) =>
    req.url.endsWith(`/data/query/enhanced/${id}`);

  const flushNoLeads = async () => {
    // specs/022: a successful batch asks the leads table once; an empty
    // centres map means this pathway has no composite
    await settle();
    http
      .expectOne('/api/leads')
      .flush({ status: 'success', leads: { composite_prefix: 'ctx-arrows_', centres: {} } });
    await settle();
  };

  const solveAndBatch = async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    http.expectOne('/api/readouts').flush(readoutsAnswer());
    await flushNoLeads();
    await solving;
    expect(service.leadState().status).toBe('none');
  };

  it('resolves a set readout through the bench member closure (specs/020)', async () => {
    await solveAndBatch();

    const resolving = service.resolveSelectedReadout('R-HSA-SET');
    http.expectOne('/api/readouts').flush(noneEntry('R-HSA-SET'));
    await settle();
    // the closure walk: a leaf member, a duplicated member (hasCandidate too),
    // and a nested sub-set whose own member joins the closure
    http.expectOne(enhancedUrl('R-HSA-SET')).flush({
      stId: 'R-HSA-SET',
      schemaClass: 'DefinedSet',
      hasMember: [
        { stId: 'R-HSA-M1', schemaClass: 'EntityWithAccessionedSequence' },
        { stId: 'R-HSA-SUB', schemaClass: 'CandidateSet' },
      ],
      hasCandidate: [{ stId: 'R-HSA-M1', schemaClass: 'EntityWithAccessionedSequence' }],
    });
    await settle();
    http.expectOne(enhancedUrl('R-HSA-SUB')).flush({
      stId: 'R-HSA-SUB',
      schemaClass: 'CandidateSet',
      hasMember: [{ stId: 'R-HSA-M2', schemaClass: 'EntityWithAccessionedSequence' }],
    });
    await settle();
    const request = http.expectOne('/api/readouts');
    const body = request.request.body as { queries: { members?: string[] }[] };
    expect(body.queries[0].members).toEqual(['R-HSA-M1', 'R-HSA-SUB', 'R-HSA-M2']);
    request.flush({
      status: 'success',
      protocol,
      missing_tables: [],
      malformed_tables: [],
      results: [
        {
          id: 'R-HSA-SET',
          mode: 'forms',
          basis: 'set_members',
          groups: [['node-b']],
          pinned: [],
          value: 0.02,
          fold: 2,
          call: 'up',
          railed: false,
        },
      ],
    });
    await resolving;

    expect(service.readoutState().byId.get('R-HSA-SET')).toMatchObject({
      basis: 'set_members',
      fold: 2,
    });
  });

  it('a non-set stays honestly unreadable, and is not retried (specs/020)', async () => {
    await solveAndBatch();

    const resolving = service.resolveSelectedReadout('R-HSA-P');
    http.expectOne('/api/readouts').flush(noneEntry('R-HSA-P'));
    await settle();
    http.expectOne(enhancedUrl('R-HSA-P')).flush({ stId: 'R-HSA-P', schemaClass: 'Protein' });
    await resolving;
    expect(service.readoutState().byId.get('R-HSA-P')?.basis).toBe('none');

    // cached none + members already tried: no request of any kind
    await service.resolveSelectedReadout('R-HSA-P');
    http.expectNone('/api/readouts');
    http.expectNone(enhancedUrl('R-HSA-P'));
  });

  it('a ContentService failure leaves the honest none entry (specs/020)', async () => {
    await solveAndBatch();

    const resolving = service.resolveSelectedReadout('R-HSA-X');
    http.expectOne('/api/readouts').flush(noneEntry('R-HSA-X'));
    await settle();
    http
      .expectOne(enhancedUrl('R-HSA-X'))
      .flush({ message: 'down' }, { status: 500, statusText: 'Server Error' });
    await resolving;
    expect(service.readoutState().byId.get('R-HSA-X')?.basis).toBe('none');
  });

  it('a closure past the fetch cap is abandoned, never truncated (specs/020)', async () => {
    await solveAndBatch();

    const resolving = service.resolveSelectedReadout('R-HSA-BIG');
    http.expectOne('/api/readouts').flush(noneEntry('R-HSA-BIG'));
    await settle();
    const subsets = Array.from({ length: 12 }, (_, i) => ({
      stId: `R-HSA-S${i}`,
      schemaClass: 'DefinedSet',
    }));
    http.expectOne(enhancedUrl('R-HSA-BIG')).flush({
      stId: 'R-HSA-BIG',
      schemaClass: 'DefinedSet',
      hasMember: subsets,
    });
    await settle();
    // 11 more fetches reach the cap of 12 with the queue still holding a set
    for (let i = 0; i < 11; i++) {
      http
        .expectOne(enhancedUrl(`R-HSA-S${i}`))
        .flush({ stId: `R-HSA-S${i}`, schemaClass: 'DefinedSet' });
      await settle();
    }
    await resolving;
    // abandoned: no second readouts query was made, the none entry stands
    http.expectNone('/api/readouts');
    expect(service.readoutState().byId.get('R-HSA-BIG')?.basis).toBe('none');
  });

  it('maps served confidence and the untouched class into rows (specs/146)', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    const answer = readoutsAnswer();
    answer.results[0] = {
      ...answer.results[0],
      confidence: 0.86,
      confidence_stratum: 'no_basis',
    };
    // the engine says the perturbation never reaches R-HSA-2 here
    answer.results[1] = {
      ...answer.results[1],
      fold: 1,
      call: 'normal',
      confidence: null,
      confidence_stratum: 'untouched',
    };
    http.expectOne('/api/readouts').flush(answer);
    await flushNoLeads();
    await solving;

    const byId = new Map(service.readoutRows().map((row) => [row.reactomeId, row]));
    expect(byId.get('R-HSA-1')).toMatchObject({ confidence: 0.86, untouched: false });
    expect(byId.get('R-HSA-2')).toMatchObject({ confidence: null, untouched: true });
    // an untouched row has no departure: it sorts last
    expect(service.readoutRows().at(-1)?.reactomeId).toBe('R-HSA-2');
  });

  const leadsTable = {
    status: 'success',
    leads: {
      composite_prefix: 'ctx-arrows_',
      centres: {
        'R-HSA-9': {
          name: 'Test',
          composite_id: 'ctx-arrows_R-HSA-9',
          arrows: [
            {
              source_pathway: 'PIP3 activates AKT signaling',
              entity: 'p-AKT',
              rate: { class: 'measured', statement: 'right 24% on the record' },
            },
          ],
        },
      },
    },
  };

  it('runs the composite once and attaches leads to not-reached rows (specs/022)', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    const answer = readoutsAnswer();
    // R-HSA-2 is untouched in the main solve
    answer.results[1] = {
      ...answer.results[1],
      fold: 1,
      call: 'normal',
      confidence: null,
      confidence_stratum: 'untouched',
    };
    http.expectOne('/api/readouts').flush(answer);
    await settle();
    http.expectOne('/api/leads').flush(leadsTable);
    await settle();
    http.expectOne((r) => r.url === '/api/parse').flush({ ...network, network_id: 'ctx:test' });
    await settle();
    const pinsReq = http.expectOne('/api/pins');
    expect((pinsReq.request.body as { network_id: string }).network_id).toBe('ctx:test');
    pinsReq.flush({
      status: 'success',
      results: [
        { id: 'R-HSA-1', basis: 'root', pins: [{ uuid: 'ctx-root', name: 'ATM' }], occurrences: 1 },
      ],
    });
    await settle();
    const solveReq = http.expectOne('/api/solve');
    expect((solveReq.request.body as { observations: object }).observations).toEqual({
      'ctx-root': [0, 1],
    });
    solveReq.flush({ ...solveAnswer, node_activities: { 'node-b': 0.0005 } });
    await settle();
    const roReq = http.expectOne('/api/readouts');
    expect((roReq.request.body as { queries: { id: string }[] }).queries).toEqual([
      { id: 'R-HSA-2', stable_ids: ['R-HSA-2'] },
    ]);
    roReq.flush({
      status: 'success',
      protocol,
      missing_tables: [],
      malformed_tables: [],
      results: [
        {
          id: 'R-HSA-2',
          mode: 'forms',
          basis: 'direct',
          groups: [['node-b']],
          pinned: [],
          value: 0.0005,
          fold: 0.05,
          call: 'down',
          railed: false,
          confidence_stratum: 'no_basis',
        },
      ],
    });
    await solving;
    await settle();

    expect(service.leadState().status).toBe('ready');
    const row = service.readoutRows().find((r) => r.reactomeId === 'R-HSA-2');
    expect(row?.untouched).toBe(true);
    expect(row?.lead).toMatchObject({ call: 'down', statement: 'right 24% on the record' });
  });

  it('a composite failure leaves the honest not-reached untouched (specs/022)', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    const answer = readoutsAnswer();
    answer.results[1] = {
      ...answer.results[1],
      fold: 1,
      call: 'normal',
      confidence: null,
      confidence_stratum: 'untouched',
    };
    http.expectOne('/api/readouts').flush(answer);
    await settle();
    http.expectOne('/api/leads').flush(leadsTable);
    await settle();
    http
      .expectOne((r) => r.url === '/api/parse')
      .flush({ message: 'down' }, { status: 500, statusText: 'Server Error' });
    await solving;
    await settle();

    expect(service.leadState().status).toBe('error');
    const row = service.readoutRows().find((r) => r.reactomeId === 'R-HSA-2');
    expect(row?.untouched).toBe(true);
    expect(row?.lead).toBeNull();
  });

  it('drops an on-demand readout that a newer solve overtook in flight', async () => {
    const solving = service.solve();
    await settle();
    http.expectOne('/api/solve').flush(solveAnswer);
    await settle();
    http.expectOne('/api/readouts').flush(readoutsAnswer());
    await flushNoLeads();
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
