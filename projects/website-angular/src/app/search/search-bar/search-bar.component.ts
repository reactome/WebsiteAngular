import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  HostListener,
  ViewChild, signal, ChangeDetectorRef, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
  imports: [DropdownToggleComponent, RouterLink],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
})
export class SearchBarComponent implements OnChanges, AfterViewInit, OnInit {
  private router = inject(Router);
  private searchService = inject(SearchService);
  private cdr = inject(ChangeDetectorRef);
  @Input() query: string = '';
  @Input() filters = false;
  @Output() queryChange = new EventEmitter<string>();

  @ViewChild('queryInput') queryInput?: ElementRef<HTMLTextAreaElement>;

  suggestions: string[] = [];
  highlightedIndex: number = -1;
  syntaxHelpOpen = false;
  allFacets: FacetResponse | null = null;
  advancedFilters: SearchFilters = {};

  // A signal because hideDropdownDelayed closes the dropdown from a
  // setTimeout, which Angular cannot see -- with zones off, a plain field
  // would leave the suggestions list stuck open after blur.
  readonly showSuggestions = signal(false);

  ngOnInit(): void {
    if (this.filters) {
      this.getAllFacets();
    }
  }

  ngAfterViewInit(): void {
    // Initial size sync in case the bar mounted with a pre-filled query.
    this.autoGrow();
  }

  onInput(event: Event): void {
    const ta = event.target as HTMLTextAreaElement;
    this.query = ta.value;
    this.autoGrow();
    this.getSuggestions(this.query);
  }

  onEnter(event: Event): void {
    // Plain Enter submits; Shift+Enter inserts a newline so a multi-line
    // boolean query is still possible.
    const kb = event as KeyboardEvent;
    if (kb.shiftKey) return;
    event.preventDefault();
    this.onSubmit(event);
  }

  // Resize the textarea to match its content so the bar looks like a
  // single-line input at rest and grows naturally for long boolean queries.
  private autoGrow(): void {
    const ta = this.queryInput?.nativeElement;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['suggestions']) {
      this.suggestions = this.suggestions ? [...this.suggestions] : [];
    }
    if (changes['query']) {
      this.query = this.query || '';
      // Defer to next tick so the textarea has the bound value before measuring.
      setTimeout(() => this.autoGrow(), 0);
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.showSuggestions.set(false);

    const q = this.query.trim();
    if (!q) {
      return;
    }

    const params: Record<string, string | string[] | null> = {
      q: q,
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
      this.showSuggestions.set(false);
    }, 150);
  }

  showDropdown(): void {
    clearTimeout(this.hideTimeout);
    this.showSuggestions.set(true);
  }

  selectSuggestion(s: string): void {
    this.showSuggestions.set(false);
    s = s.trim();
    if (!s) {
      return;
    }

    const params: Record<string, string | string[] | null> = {
      q: s,
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
        this.cdr.markForCheck();
      },
      error: () => {
        this.suggestions = [];
        this.cdr.markForCheck();
      },
    });
  }

  private getAllFacets(): void {
    this.searchService.getAllFacets().subscribe({
      next: (facets) => {
        this.allFacets = facets;
        this.cdr.markForCheck();
      },
      error: () => {
        this.allFacets = null;
        this.cdr.markForCheck();
      },
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
    if (this.suggestions.length > 0 && this.showSuggestions()) {
      this.highlightedIndex =
        (this.highlightedIndex + 1) % this.suggestions.length;
      this.query = this.suggestions[this.highlightedIndex];
    }
  }

  @HostListener('window:keydown.arrowup', ['$event'])
  onKeyDownArrowUp(event: KeyboardEvent): void {
    event.preventDefault();
    if (this.suggestions.length > 0 && this.showSuggestions()) {
      this.highlightedIndex =
        (this.highlightedIndex - 1 + this.suggestions.length) %
        this.suggestions.length;
      this.query = this.suggestions[this.highlightedIndex];
    }
  }
}
