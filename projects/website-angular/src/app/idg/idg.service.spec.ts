import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { IdgService } from './idg.service';

// A failed request is not an answer: the page has to be able to tell "the
// service said no" from "the service did not say".
describe('IdgService', () => {
  let service: IdgService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(IdgService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const fail = (url: string) =>
    http
      .expectOne((request) => request.url.endsWith(url))
      .flush('down', { status: 500, statusText: 'Server Error' });

  describe('checkTerm', () => {
    it('passes on what the service says', async () => {
      const known = firstValueFrom(service.checkTerm('TANC1'));
      http.expectOne((request) => request.url.endsWith('/checkTerm/TANC1')).flush(false);
      await expect(known).resolves.toBe(false);
    });

    it('fails when the service does not answer, rather than saying the term is unknown', async () => {
      const known = firstValueFrom(service.checkTerm('TANC1'));
      fail('/checkTerm/TANC1');
      await expect(known).rejects.toBeDefined();
    });
  });

  describe('pathwayDetail', () => {
    const ID = 'R-HSA-69620';
    const summation = () => http.expectOne((r) => r.url.endsWith(`/data/query/enhanced/${ID}`));
    const ancestors = () => http.expectOne((r) => r.url.endsWith(`/data/event/${ID}/ancestors`));

    it('gives the description and the hierarchy, root first', async () => {
      const detail = firstValueFrom(service.pathwayDetail(ID));
      summation().flush({ summation: [{ text: 'Checks.<br>More.' }] });
      ancestors().flush([
        [
          { stId: ID, displayName: 'Cell Cycle Checkpoints' },
          { stId: 'R-HSA-1640170', displayName: 'Cell Cycle' },
        ],
      ]);
      await expect(detail).resolves.toEqual({
        summation: 'Checks.\nMore.',
        hierarchy: [
          { stId: 'R-HSA-1640170', name: 'Cell Cycle' },
          { stId: ID, name: 'Cell Cycle Checkpoints' },
        ],
        incomplete: false,
      });
    });

    it('says so when the description could not be loaded', async () => {
      const detail = firstValueFrom(service.pathwayDetail(ID));
      fail(`/data/query/enhanced/${ID}`);
      ancestors().flush([[{ stId: ID, displayName: 'Cell Cycle Checkpoints' }]]);
      await expect(detail).resolves.toEqual({
        summation: undefined,
        hierarchy: [{ stId: ID, name: 'Cell Cycle Checkpoints' }],
        incomplete: true,
      });
    });

    it('says so when the hierarchy could not be loaded', async () => {
      const detail = firstValueFrom(service.pathwayDetail(ID));
      summation().flush({ summation: [{ text: 'Checks.' }] });
      fail(`/data/event/${ID}/ancestors`);
      await expect(detail).resolves.toEqual({
        summation: 'Checks.',
        hierarchy: [],
        incomplete: true,
      });
    });
  });

  describe('hierarchy', () => {
    const URL = '/realtionships/getHierarchicalOrderedPathways';

    it('asks again after a failure, rather than keeping it for the visit', async () => {
      const first = firstValueFrom(service.hierarchy());
      fail(URL);
      await expect(first).rejects.toBeDefined();

      const second = firstValueFrom(service.hierarchy());
      http
        .expectOne((request) => request.url.endsWith(URL))
        .flush([{ stId: 'R-HSA-69620', topPathway: 'R-HSA-1640170' }]);
      await expect(second).resolves.toEqual({ 'R-HSA-69620': 'R-HSA-1640170' });
    });

    it('asks once when it succeeds', async () => {
      const first = firstValueFrom(service.hierarchy());
      http.expectOne((request) => request.url.endsWith(URL)).flush([]);
      await first;
      await expect(firstValueFrom(service.hierarchy())).resolves.toEqual({});
      http.expectNone((request) => request.url.endsWith(URL));
    });
  });
});
