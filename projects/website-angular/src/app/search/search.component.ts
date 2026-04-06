import { Component, inject, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, NgZone } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin, catchError, Observable } from 'rxjs';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { TileComponent } from '../reactome-components/tile/tile.component';
import { SearchBarComponent } from './search-bar/search-bar.component';
import {
  SearchService,
  SearchResult,
  SearchEntry,
  FacetResponse,
  SearchFilters,
  FacetCount,
} from '../../services/search.service';
import { DatePipe } from '@angular/common';
import { MatIcon } from "@angular/material/icon";

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [PageLayoutComponent, TileComponent, RouterLink, SearchBarComponent, FormsModule, DatePipe, MatIcon],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private searchService = inject(SearchService);
  private http = inject(HttpClient);
  private ngZone = inject(NgZone);

  @ViewChild('captchaContainer') captchaContainer!: ElementRef<HTMLDivElement>;

  captchaToken: string | null = null;
  private captchaWidgetId: string | null = null;

  query = '';
  searchSubmitted = false;
    onQueryInput(newQuery: string): void {
      this.query = newQuery;
      this.getSuggestions(newQuery);
      this.searchSubmitted = false;
    }
  suggestedTerms: string[] = [];
  results: SearchResult | null = null;
  facets: FacetResponse | null = null;
  loading = false;
  error = '';
  hasNoResults = false;
  formSubmitted = false;

  currentPage = 0;
  pageSize = 30;
  totalPages = 0;

  filters: SearchFilters = {};

  grouped = true;

  collapsedFacets: Record<string, boolean> = {};
  collapsedGroups: Record<string, boolean> = {};

  advancedMode = false;

  private paramsSub!: Subscription;

  ngOnInit(): void {
    this.paramsSub = this.route.queryParams.subscribe((params) => {
      // Check query params first, then fall back to query embedded in URL path (e.g. /content/query=kj)
      let q = params['q'] || '';
      if (!q) {
        const pathSegments = this.route.snapshot.url;
        if (pathSegments.length === 2 && pathSegments[1].path.startsWith('query=')) {
          q = decodeURIComponent(pathSegments[1].path.substring('query='.length));
        }
      }

      this.query = q;
      this.currentPage = params['page'] ? parseInt(params['page'], 10) - 1 : 0;

      this.filters = {
        species: toArray(params['species']),
        types: toArray(params['types']),
        compartments: toArray(params['compartments']),
        keywords: toArray(params['keywords']),
      };

      if (params['advanced'] === 'true' && !this.advancedMode) {
        this.toggleAdvancedMode();
      } else if (params['advanced'] !== 'true' && this.advancedMode) {
        this.advancedMode = false;
      }

      if (this.query) {
        this.searchSubmitted = true;
        this.doSearch();
        this.getSuggestions(this.query);
      }
    });
  }

  ngAfterViewInit(): void {
    this.renderCaptchaWhenReady();
  }

  ngOnDestroy(): void {
    this.paramsSub?.unsubscribe();
  }

  private getSuggestions(query: string): void {
      if (!query) {
        this.suggestedTerms = [];
        return;
      }
      this.searchService.getSpellCheckTerms(query).subscribe({
        next: (terms) => {
          this.suggestedTerms = terms || [];
        },
        error: () => {
          this.suggestedTerms = [];
        },
      });
    }

  private renderCaptchaWhenReady(): void {
    // Wait until the captcha container is available in the DOM
    const checkContainer = () => {
      if (this.captchaContainer?.nativeElement) {
        this.loadHCaptchaScript().then(() => this.renderCaptcha());
      } else {
        setTimeout(checkContainer, 200);
      }
    };
    checkContainer();
  }

  private loadHCaptchaScript(): Promise<void> {
    return new Promise((resolve) => {
      if ((window as any).hcaptcha) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  private renderCaptcha(): void {
    const hcaptcha = (window as any).hcaptcha;
    if (!hcaptcha || !this.captchaContainer?.nativeElement) return;

    this.captchaWidgetId = hcaptcha.render(this.captchaContainer.nativeElement, {
      sitekey: 'a7e45eb1-ba7a-47a7-95da-5c67d948dd4f',
      theme: 'light',
      callback: (token: string) => {
        this.ngZone.run(() => { this.captchaToken = token; });
      },
      'expired-callback': () => {
        this.ngZone.run(() => { this.captchaToken = null; });
      },
      'error-callback': () => {
        this.ngZone.run(() => { this.captchaToken = null; });
      },
    });
  }

  private resetCaptcha(): void {
    const hcaptcha = (window as any).hcaptcha;
    if (hcaptcha && this.captchaWidgetId != null) {
      hcaptcha.reset(this.captchaWidgetId);
    }
    this.captchaToken = null;
  }

  private doSearch(): void {
    this.loading = true;
    this.error = '';
    this.hasNoResults = false;

    forkJoin({
      results: this.searchService.search(this.query, this.filters, this.currentPage, this.pageSize).pipe(
        catchError((err) => this.handleSearchError(err))
      ),
      facets: this.searchService.getFacets(this.query, this.filters).pipe(
        catchError(() => of(null))
      ),
    }).subscribe({
      next: ({ results, facets }) => {
        // If either API call failed, show error
        if (!results || !facets) {
          this.error = 'An error occurred while searching. Please try again.';
          this.results = null;
          this.facets = null;
          this.hasNoResults = false;
        } else {
          // Successful API response - check if we have results
          const res = results as SearchResult;
          const hasNonDeleted = res.results?.some(group =>
            group.entries.some(e => !e.deleted)
          );
          res.results = res.results?.map(group => {
            const entries = hasNonDeleted
              ? group.entries.filter(e => !e.deleted)
              : group.entries;

            return {
              ...group,
              entries,
              entriesCount: entries.length
            };
          }).filter(group => group.entries.length > 0) || [];
          res.numberOfMatches = res.results.reduce(
            (sum, g) => sum + g.entries.length,
            0
          );
          this.results = res;
          this.facets = facets;
          this.totalPages = this.totalPages = Math.max(
            ...(results.results || []).map(group =>
              Math.ceil((group.entriesCount || 0) / this.pageSize)
            ),
            0
          );
          this.hasNoResults = ((results as SearchResult).numberOfMatches || 0) === 0;
          this.error = '';
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = 'An error occurred while searching. Please try again.';
        this.hasNoResults = false;
        this.results = null;
        this.facets = null;
        this.loading = false;
      },
    });
  }

  private handleSearchError(err: any): Observable<SearchResult | null> {
    // Check if this is a 404 with "No entries found" message
    if (err.status === 404 && err.error?.messages?.[0]?.includes('No entries found')) {
      // Return empty results instead of throwing error
      return of({
        results: [],
        rowCount: 0,
        numberOfMatches: 0,
      });
    }
    // For other errors, return null
    return of(null);
  }

  get allEntries(): SearchEntry[] {
    if (!this.results?.results) return [];
    return this.results.results.flatMap(g => this.filterDeletedEntries(g.entries));
  }

  toggleFacet(category: string, value: string): void {
    const key = category as keyof SearchFilters;
    const current = this.filters[key] || [];
    const index = current.indexOf(value);

    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(value);
    }

    this.updateQueryParams({ [category]: current.length ? current : null, page: null });
  }

  isFacetSelected(category: string, value: string): boolean {
    const current = this.filters[category as keyof SearchFilters] || [];
    return current.includes(value);
  }

  goToPage(page: number): void {
    if (page < 0 || page >= this.totalPages) return;
    this.updateQueryParams({ page: page > 0 ? (page + 1).toString() : null });
  }

  toggleFacetSection(section: string): void {
    this.collapsedFacets[section] = !this.collapsedFacets[section];
  }

  toggleGroup(group: string): void {
    this.collapsedGroups[group] = !this.collapsedGroups[group];
  }

  toggleAdvancedMode(): void {
    this.advancedMode = !this.advancedMode;
  }

  private filterDeletedEntries(entries: SearchEntry[]): SearchEntry[] {
    if (!entries?.length) return [];

    const nonDeleted = entries.filter(e => !e.deleted);
    if (nonDeleted.length > 0) {
      return nonDeleted;
    }

    return entries;
  }

  private updateQueryParams(params: Record<string, string | string[] | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  getFacetItems(facet: { selected: FacetCount[]; available: FacetCount[] } | undefined): FacetCount[] {
    if (!facet) return [];
    return [...(facet.selected || []), ...(facet.available || [])];
  }

  getActiveFilters(): { category: string; label: string; value: string }[] {
    const active: { category: string; label: string; value: string }[] = [];
    const labels: Record<string, string> = {
      species: 'Species',
      types: 'Type',
      compartments: 'Compartment',
      keywords: 'Keyword',
    };
    for (const [key, values] of Object.entries(this.filters)) {
      if (values?.length) {
        for (const v of values) {
          active.push({ category: key, label: labels[key] || key, value: v });
        }
      }
    }
    return active;
  }

  getDetailLink(entry: SearchEntry): string {
    if (entry.exactType === 'Interactor') return '/content/detail/interactor/' + entry.stId;
    if (entry.exactType === 'Icon') return '/content/detail/icon/' + entry.stId;
    return '/content/detail/' + entry.stId;
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(0, this.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPages, start + maxVisible);

    if (end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }

    for (let i = start; i < end; i++) {
      pages.push(i);
    }
    return pages;
  }

  submitContactForm(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.captchaToken) {
      return;
    }

    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    formData.set('h-captcha-response', this.captchaToken);

    this.http.post('/content/contact', formData).subscribe({ //TODO: Post to the actual route
      next: () => {
        this.formSubmitted = true;
        this.resetCaptcha();
      },
      error: (err) => {
        console.error('Error submitting contact form:', err);
        this.formSubmitted = true; // Still show thank you message even if there's an error
        this.resetCaptcha();
      },
    });
  }
}


function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}