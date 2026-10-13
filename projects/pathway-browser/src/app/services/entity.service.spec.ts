import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { UrlStateService } from './url-state.service';
import { RouterUrlStateService } from './router-url-state.service';
import { firstValueFrom } from 'rxjs';
import { EntityService } from './entity.service';

// The content service answers /data/entity/{id}/in-depth for an entity it has
// nothing to nest under -- a protein or RNA drug, some sequences and small
// molecules, an id it does not know -- with 200 and an empty body, which
// HttpClient gives as null. That is an answer of nothing, not a failure.
describe('EntityService.getEntityInDepth', () => {
  let service: EntityService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: UrlStateService, useClass: RouterUrlStateService },
      ],
    });
    service = TestBed.inject(EntityService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const inDepth = () => http.expectOne((request) => request.url.includes('/in-depth'));

  it('gives null for an empty answer', async () => {
    const entity = firstValueFrom(service.getEntityInDepth('R-ALL-9845174', 1));
    inDepth().flush(null);
    await expect(entity).resolves.toBeNull();
  });

  it('gives the entity it was sent', async () => {
    const entity = firstValueFrom(service.getEntityInDepth('R-HSA-1', 1));
    inDepth().flush({ dbId: 1, stId: 'R-HSA-1', displayName: 'A', schemaClass: 'Complex' });
    await expect(entity).resolves.toMatchObject({ stId: 'R-HSA-1' });
  });
});
