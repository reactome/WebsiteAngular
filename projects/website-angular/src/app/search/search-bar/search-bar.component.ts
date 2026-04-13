import {
  Component,
  inject,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  HostListener,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  FacetCount,
  FacetResponse,
  SearchFilters,
  SearchService,
} from 'projects/website-angular/src/services/search.service';
import { DropdownToggleComponent } from '../../reactome-components/dropdown-toggle/dropdown-toggle.component';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [DropdownToggleComponent],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
})
export class SearchBarComponent implements OnChanges {
  private router = inject(Router);
  private searchService = inject(SearchService);
  @Input() query: string = '';
  @Input() currentMode: 'advanced' | 'reference' | 'simple' = 'simple';
  @Input() filters = false;
  @Output() queryChange = new EventEmitter<string>();

  suggestions: string[] = [];
  highlightedIndex: number = -1;
  syntaxHelpOpen = false;
  allFacets: FacetResponse | null = null;
  advancedFilters: SearchFilters = {};

  showSuggestions = false;

  ngOnInit(): void {
    if (this.filters) {
      this.getAllFacets();
    }
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query = value;
    this.getSuggestions(this.query);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['suggestions']) {
      this.suggestions = this.suggestions ? [...this.suggestions] : [];
    }
    if (changes['query']) {
      this.query = this.query || '';
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.showSuggestions = false;

    const q = this.query.trim();
    if (!q) {
      return;
    }

    const params: Record<string, string | string[] | null> = {
      q: q,
      advanced: this.currentMode === 'advanced' ? 'true' : null,
      reference: this.currentMode === 'reference' ? 'true' : null,
      page: null,
    };

    for (const key of [
      'species',
      'types',
      'compartments',
      'keywords',
    ] as const) {
      const values = this.advancedFilters[key];
      params[key] = values?.length ? values : null;
    }

    this.router.navigate(['/content/query'], { queryParams: params });
    this.highlightedIndex = -1;

    this.queryChange.emit(q);
  }

  hideTimeout?: number;

  hideDropdownDelayed(): void {
    this.hideTimeout = window.setTimeout(() => {
      this.showSuggestions = false;
    }, 150);
  }

  showDropdown(): void {
    clearTimeout(this.hideTimeout);
    this.showSuggestions = true;
  }

  selectSuggestion(s: string): void {
    this.showSuggestions = false;
    s = s.trim();
    if (!s) {
      return;
    }

    const params: Record<string, string | string[] | null> = {
      q: s,
      advanced: this.currentMode === 'advanced' ? 'true' : null,
      reference: this.currentMode === 'reference' ? 'true' : null,
      page: null,
    };

    for (const key of [
      'species',
      'types',
      'compartments',
      'keywords',
    ] as const) {
      const values = this.advancedFilters[key];
      params[key] = values?.length ? values : null;
    }

    this.highlightedIndex = -1;
    this.query = s;

    this.router.navigate(['/content/query'], { queryParams: params });
    this.queryChange.emit(s);
  }

  private getSuggestions(query: string): void {
    if (!query) {
      this.suggestions = [];
      return;
    }
    this.searchService.getSuggestedTerms(query).subscribe({
      next: (terms) => {
        this.suggestions = terms || [];
      },
      error: () => {
        this.suggestions = [];
      },
    });
  }

  private getAllFacets(): void {
    this.searchService.getAllFacets().subscribe({
      next: (facets) => (this.allFacets = facets),
      error: () => (this.allFacets = null),
    });
  }

  getFacetItems(
    facet: { selected: FacetCount[]; available: FacetCount[] } | undefined
  ): FacetCount[] {
    if (!facet) return [];
    return [...(facet.selected || []), ...(facet.available || [])];
  }

  isAdvancedFacetSelected(category: string, value: string): boolean {
    return (
      this.advancedFilters[category as keyof SearchFilters] || []
    ).includes(value);
  }

  toggleAdvancedFacet(category: string, value: string): void {
    const key = category as keyof SearchFilters;
    const current = this.advancedFilters[key] || [];
    const index = current.indexOf(value);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(value);
    }
    this.advancedFilters[key] = current;
  }

  @HostListener('window:keydown.arrowdown', ['$event'])
  onKeyDownArrowDown(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.suggestions.length > 0 && this.showSuggestions) {
      this.highlightedIndex =
        (this.highlightedIndex + 1) % this.suggestions.length;
      this.query = this.suggestions[this.highlightedIndex];
    }
  }

  @HostListener('window:keydown.arrowup', ['$event'])
  onKeyDownArrowUp(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.suggestions.length > 0 && this.showSuggestions) {
      this.highlightedIndex =
        (this.highlightedIndex - 1 + this.suggestions.length) %
        this.suggestions.length;
      this.query = this.suggestions[this.highlightedIndex];
    }
  }
}
