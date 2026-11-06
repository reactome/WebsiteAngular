import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DeltaSignalService } from './deltasignal.service';
import { buildObservations } from './deltasignal.utils';
import type { DeltaSignalNetwork, DeltaSignalPinsResponse } from './deltasignal.model';

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
