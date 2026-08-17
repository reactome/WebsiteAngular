import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SearchService, SearchFilters } from './search.service';
import { CONTENT_SERVICE } from '../../../../projects/pathway-browser/src/environments/environment';

describe('SearchService', () => {
  let service: SearchService;
  let httpTesting: HttpTestingController;
  // Derived exactly as the service derives it. CONTENT_SERVICE is built from
  // window.location.origin, so hardcoding a host here made every expectOne()
  // miss under jsdom: the unmatched request then tripped verify() in afterEach,
  // which cascaded into "TestBed already instantiated" for the whole file.
  const baseUrl = `${CONTENT_SERVICE}/search`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SearchService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  describe('search()', () => {
    it('should send correct query, cluster, and pagination params', () => {
      service.search('TP53', {}, 2, 30).subscribe();

      const req = httpTesting.expectOne((r) => r.url === `${baseUrl}/query`);
      expect(req.request.params.get('query')).toBe('TP53');
      expect(req.request.params.get('cluster')).toBe('true');
      expect(req.request.params.get('Start row')).toBe('60');
      expect(req.request.params.get('rows')).toBe('30');
      req.flush({ results: [], rowCount: 0, numberOfMatches: 0 });
    });

    it('should append multiple species/types/compartments/keywords as separate params', () => {
      const filters: SearchFilters = {
        species: ['Homo sapiens', 'Mus musculus'],
        types: ['Pathway', 'Reaction'],
        compartments: ['cytosol', 'nucleus'],
        keywords: ['disease', 'signaling'],
      };
      service.search('BRCA1', filters, 0, 10).subscribe();

      const req = httpTesting.expectOne((r) => r.url === `${baseUrl}/query`);
      expect(req.request.params.getAll('species')).toEqual(['Homo sapiens', 'Mus musculus']);
      expect(req.request.params.getAll('types')).toEqual(['Pathway', 'Reaction']);
      expect(req.request.params.getAll('compartments')).toEqual(['cytosol', 'nucleus']);
      expect(req.request.params.getAll('keywords')).toEqual(['disease', 'signaling']);
      req.flush({ results: [], rowCount: 0, numberOfMatches: 0 });
    });

    it('should use default pagination params when not provided', () => {
      service.search('apoptosis').subscribe();

      const req = httpTesting.expectOne((r) => r.url === `${baseUrl}/query`);
      expect(req.request.params.get('query')).toBe('apoptosis');
      expect(req.request.params.get('Start row')).toBe('0');
      expect(req.request.params.get('rows')).toBe('30');
      req.flush({ results: [], rowCount: 0, numberOfMatches: 0 });
    });
  });

  describe('getFacets()', () => {
    it('should send to /facet_query with filters', () => {
      const filters: SearchFilters = { species: ['Homo sapiens'] };
      service.getFacets('TP53', filters).subscribe();

      const req = httpTesting.expectOne((r) => r.url === `${baseUrl}/facet_query`);
      expect(req.request.params.get('query')).toBe('TP53');
      expect(req.request.params.getAll('species')).toEqual(['Homo sapiens']);
      req.flush({});
    });
  });

  describe('getSpellCheckTerms()', () => {
    it('should URL-encode the query', () => {
      service.getSpellCheckTerms('foo bar&baz').subscribe();

      const req = httpTesting.expectOne((r) => r.url.includes('/spellcheck'));
      expect(req.request.url).toContain('query=foo%20bar%26baz');
      req.flush([]);
    });
  });
});
