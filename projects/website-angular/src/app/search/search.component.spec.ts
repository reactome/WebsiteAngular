import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { SearchComponent } from './search.component';
import { SearchEntry } from '../../services/search.service';

function makeEntry(overrides: Partial<SearchEntry> = {}): SearchEntry {
  return {
    dbId: 1,
    stId: 'R-HSA-123',
    name: 'Test',
    type: 'Pathway',
    exactType: 'Pathway',
    species: ['Homo sapiens'],
    summation: '',
    compartmentNames: [],
    isDisease: false,
    referenceName: '',
    referenceIdentifier: '',
    databaseName: '',
    referenceURL: '',
    ...overrides,
  };
}

describe('SearchComponent', () => {
  let component: SearchComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: of({}),
            snapshot: { url: [] },
          },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new SearchComponent());
  });

  describe('allEntries', () => {
    it('should flatten groups into a single array', () => {
      component.results = {
        results: [
          { typeName: 'Pathway', entries: [makeEntry({ stId: 'R-1' }), makeEntry({ stId: 'R-2' })], entriesCount: 2, rowCount: 2 },
          { typeName: 'Reaction', entries: [makeEntry({ stId: 'R-3' })], entriesCount: 1, rowCount: 1 },
        ],
        rowCount: 3,
        numberOfMatches: 3,
      };
      expect(component.allEntries.length).toBe(3);
      expect(component.allEntries.map(e => e.stId)).toEqual(['R-1', 'R-2', 'R-3']);
    });

    it('should return [] when results is null', () => {
      component.results = null;
      expect(component.allEntries).toEqual([]);
    });
  });

  describe('getDetailLink()', () => {
    it('should return interactor path for Interactor type', () => {
      expect(component.getDetailLink(makeEntry({ exactType: 'Interactor', stId: 'Q123' }))).toBe(
        '/content/detail/interactor/Q123'
      );
    });

    it('should return icon path for Icon type', () => {
      expect(component.getDetailLink(makeEntry({ exactType: 'Icon', stId: 'ICO-1' }))).toBe(
        '/content/detail/icon/ICO-1'
      );
    });

    it('should return default path for other types', () => {
      expect(component.getDetailLink(makeEntry({ exactType: 'Pathway', stId: 'R-HSA-123' }))).toBe(
        '/content/detail/R-HSA-123'
      );
    });
  });

  describe('getPageNumbers()', () => {
    it('should return correct page range for middle pages', () => {
      component.totalPages = 20;
      component.currentPage = 10;
      expect(component.getPageNumbers()).toEqual([8, 9, 10, 11, 12]);
    });

    it('should clamp to start when near beginning', () => {
      component.totalPages = 20;
      component.currentPage = 1;
      expect(component.getPageNumbers()).toEqual([0, 1, 2, 3, 4]);
    });

    it('should clamp to end when near end', () => {
      component.totalPages = 5;
      component.currentPage = 4;
      expect(component.getPageNumbers()).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('goToPage()', () => {
    it('should be a no-op for negative page', () => {
      component.totalPages = 10;
      component.currentPage = 5;
      component.goToPage(-1);
    });

    it('should be a no-op for page >= totalPages', () => {
      component.totalPages = 10;
      component.currentPage = 5;
      component.goToPage(10);
    });
  });

  describe('getActiveFilters()', () => {
    it('should aggregate filter entries with labels', () => {
      component.filters = {
        species: ['Homo sapiens'],
        types: ['Pathway', 'Reaction'],
      };
      const active = component.getActiveFilters();
      expect(active).toEqual([
        { category: 'species', label: 'Species', value: 'Homo sapiens' },
        { category: 'types', label: 'Type', value: 'Pathway' },
        { category: 'types', label: 'Type', value: 'Reaction' },
      ]);
    });

    it('should return empty array when no filters set', () => {
      component.filters = {};
      expect(component.getActiveFilters()).toEqual([]);
    });
  });

  describe('toggleFacet()', () => {
    it('should add a value when not present', () => {
      component.filters = { species: [] };
      component.toggleFacet('species', 'Homo sapiens');
      expect(component.filters.species).toContain('Homo sapiens');
    });

    it('should remove a value when already present', () => {
      component.filters = { species: ['Homo sapiens'] };
      component.toggleFacet('species', 'Homo sapiens');
      expect(component.filters.species).not.toContain('Homo sapiens');
    });
  });

  describe('getFacetItems()', () => {
    it('should merge selected and available items', () => {
      const facet = {
        selected: [{ name: 'Pathway', count: 10 }],
        available: [{ name: 'Reaction', count: 5 }],
      };
      expect(component.getFacetItems(facet)).toEqual([
        { name: 'Pathway', count: 10 },
        { name: 'Reaction', count: 5 },
      ]);
    });

    it('should return empty array for undefined facet', () => {
      expect(component.getFacetItems(undefined)).toEqual([]);
    });
  });
});
