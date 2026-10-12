import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { IconService } from './icon.service';

// The icon for an identifier is the first Icon hit of a search, and a search
// that finds nothing is an answer: no icon, not an error.
describe('IconService.fetchIcon', () => {
  let service: IconService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(IconService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  const search = () => http.expectOne((request) => request.url.includes('/search/query'));

  it('gives no icon when the search has no result groups at all', async () => {
    const icon = firstValueFrom(service.fetchIcon('XYZZY1'));
    search().flush({ results: [] });
    await expect(icon).resolves.toBeNull();
    expect(service.currentIcon()).toBeUndefined();
  });

  it('gives no icon when the first group is not icons', async () => {
    const icon = firstValueFrom(service.fetchIcon('TP53'));
    search().flush({ results: [{ typeName: 'Protein', entries: [{ stId: 'R-HSA-1' }] }] });
    await expect(icon).resolves.toBeNull();
  });

  it('loads the first icon found', async () => {
    const icon = firstValueFrom(service.fetchIcon('CSK'));
    search().flush({
      results: [{ typeName: 'Icon', entries: [{ stId: 'R-ICO-013624', name: 'CSK' }] }],
    });
    http.expectOne((request) => request.url.includes('R-ICO-013624')).flush('<svg/>');
    await expect(icon).resolves.toBe('<svg/>');
    expect(service.currentIcon()?.stId).toBe('R-ICO-013624');
  });
});

// Every kind of entity the trees and lists show needs an icon of its own name:
// a missing one falls back to "?", which mat-icon cannot find, and logs an
// error for every row (an RNA drug in R-HSA-9845192's participants did).
describe('IconService.getIconDetails', () => {
  it('has an icon for every kind of drug', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(IconService);
    for (const schemaClass of ['ChemicalDrug', 'ProteinDrug', 'RNADrug']) {
      const icon = service.getIconDetails({ dbId: 1, displayName: 'x', schemaClass });
      expect(icon.name, schemaClass).not.toBe('?');
    }
  });
});
