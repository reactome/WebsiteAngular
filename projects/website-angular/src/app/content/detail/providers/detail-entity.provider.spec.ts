import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';

import { EntityService } from '../../../../../../pathway-browser/src/app/services/entity.service';
import { DetailEntityService } from './detail-entity.provider';

const methods = (type: { prototype: object }): string[] =>
  Object.getOwnPropertyNames(type.prototype).filter(
    (name) =>
      name !== 'constructor' &&
      typeof Object.getOwnPropertyDescriptor(type.prototype, name)?.value === 'function'
  );

// The detail page stands this in for the Pathway Browser's EntityService, and
// the Browser's panels call whatever EntityService has. A method missing here
// is a TypeError on the detail page and nowhere else: "Other Pathways" read
// "Couldn't load the other pathways this takes part in" on every entity's
// page, because getParticipatingPathways was never added here when the panel
// began calling it. `implements Partial<EntityService>` let that through.
describe('DetailEntityService, standing in for EntityService', () => {
  it('has every method EntityService has', () => {
    const own = new Set(methods(DetailEntityService));
    expect(methods(EntityService).filter((name) => !own.has(name))).toEqual([]);
  });
});

describe('DetailEntityService.getParticipatingPathways', () => {
  // A content page's species is always human; an object's pathways are its own
  // species' anyway. Filtered by human, a mouse entity's ten pathways were a
  // 404, and "Other Pathways" vanished from its page.
  it('asks for the pathways without a species', () => {
    TestBed.configureTestingModule({
      providers: [DetailEntityService, provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(DetailEntityService);
    const http = TestBed.inject(HttpTestingController);
    let answer: unknown;
    service
      .getParticipatingPathways('R-MMU-2562550', '9606')
      .subscribe((value) => (answer = value));
    const request = http.expectOne((r) =>
      r.url.endsWith('/data/pathways/low/entity/R-MMU-2562550')
    );
    expect(request.request.params.keys()).toEqual([]);
    request.flush([{ stId: 'R-MMU-1' }]);
    expect(answer).toEqual([{ stId: 'R-MMU-1' }]);
    http.verify();
  });

  // A chemical is shared by every species: unfiltered, ATP's page listed its
  // 4,794 pathways in every species, unlabelled, against 660 in the current
  // one. So for those the current species stays.
  it('keeps the current species for an object shared by every species', () => {
    TestBed.configureTestingModule({
      providers: [DetailEntityService, provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(DetailEntityService);
    const http = TestBed.inject(HttpTestingController);
    service.getParticipatingPathways('R-ALL-113592', '9606').subscribe();
    const request = http.expectOne((r) => r.url.endsWith('/data/pathways/low/entity/R-ALL-113592'));
    expect(request.request.params.get('species')).toBe('9606');
    request.flush([]);
    http.verify();
  });
});
