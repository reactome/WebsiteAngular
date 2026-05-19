import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  NgZone,
} from '@angular/core';
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
  ResultGroup,
} from '../../services/search.service';
import { DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { getSubjectIcon, SubjectIcon } from '../../utils/subjectIcons';
import { SiteSearchService, SitePageHit } from '../../services/site-search.service';
import {
  environment,
  CONTENT_SERVICE,
} from '../../../../pathway-browser/src/environments/environment';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [
    PageLayoutComponent,
    TileComponent,
    RouterLink,
    SearchBarComponent,
    FormsModule,
    DatePipe,
    MatIcon,
    MatTooltip,
  ],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private searchService = inject(SearchService);
  private siteSearch = inject(SiteSearchService);
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

  // Filter panel visibility. Defaults to visible on desktop; on narrow
  // screens the user can collapse it via the toggle button.
  filtersVisible = true;

  collapsedFacets: Record<string, boolean> = {};
  collapsedGroups: Record<string, boolean> = {};
  expandedForms: Record<string, boolean> = {};
  groupPages: Record<string, number> = {};
  groupPageSize = 10;
  groupPageEntries: Record<string, SearchEntry[]> = {};
  groupLoading: Record<string, boolean> = {};

  // Site-search hit counts by category, populated from the merged Pages
  // results so the sidebar can offer them as a facet group.
  pageCategoryCounts: FacetCount[] = [];

  // Protein deduplication: all forms grouped by referenceIdentifier
  proteinForms = new Map<string, SearchEntry[]>();
  uniqueProteins: SearchEntry[] = [];
  proteinTotalForms = 0;
  proteinLoading = false;

  // Unified search now always uses reference-style aggregation: one row per
  // reference entity (e.g. one TP53) with modified forms / isoforms collapsed
  // under it. The old simple/advanced/site-search tabs are gone — the
  // `currentMode` field is retained as a compile-time-only constant so the
  // existing template branches (and the URL params for inbound links)
  // continue to work without conditional logic.
  currentMode: 'reference' = 'reference';

  private paramsSub!: Subscription;

  ngOnInit(): void {
    this.paramsSub = this.route.queryParams.subscribe((params) => {
      // Check query params first, then fall back to query embedded in URL path (e.g. /content/query=kj)
      let q = params['q'] || '';
      if (!q) {
        const pathSegments = this.route.snapshot.url;
        if (
          pathSegments.length === 2 &&
          pathSegments[1].path.startsWith('query=')
        ) {
          q = decodeURIComponent(
            pathSegments[1].path.substring('query='.length)
          );
        }
      }

      this.query = q;
      this.currentPage = params['page'] ? parseInt(params['page'], 10) - 1 : 0;

      this.filters = {
        species: toArray(params['species']),
        types: toArray(params['types']),
        compartments: toArray(params['compartments']),
        keywords: toArray(params['keywords']),
        pageCategories: toArray(params['pageCategories']),
      };

      // ?advanced / ?reference / ?site-search URL params from legacy inbound
      // links are accepted silently — the unified search behaves the same
      // regardless. Solr handles boolean / phrase / wildcard syntax natively.

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

    this.captchaWidgetId = hcaptcha.render(
      this.captchaContainer.nativeElement,
      {
        sitekey: 'a7e45eb1-ba7a-47a7-95da-5c67d948dd4f',
        theme: 'light',
        callback: (token: string) => {
          this.ngZone.run(() => {
            this.captchaToken = token;
          });
        },
        'expired-callback': () => {
          this.ngZone.run(() => {
            this.captchaToken = null;
          });
        },
        'error-callback': () => {
          this.ngZone.run(() => {
            this.captchaToken = null;
          });
        },
      }
    );
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
      results: this.searchService
        .search(this.query, this.filters, this.currentPage, this.pageSize)
        .pipe(catchError((err) => this.handleSearchError(err))),
      facets: this.searchService
        .getFacets(this.query, this.filters)
        .pipe(catchError(() => of(null))),
      pages: this.siteSearch
        .search(this.query)
        .pipe(catchError(() => of([] as SitePageHit[]))),
    }).subscribe({
      next: ({ results, facets, pages }) => {
        // If either API call failed, show error
        if (!results || !facets) {
          this.error = 'An error occurred while searching. Please try again.';
          this.results = null;
          this.facets = null;
          this.hasNoResults = false;
        } else {
          // Successful API response - check if we have results
          const res = results as SearchResult;
          const hasNonDeleted = res.results?.some((group) =>
            group.entries.some((e) => !e.deleted)
          );
          res.results =
            res.results
              ?.map((group) => {
                const entries = hasNonDeleted
                  ? group.entries.filter((e) => !e.deleted)
                  : group.entries;

                return {
                  ...group,
                  entries,
                  entriesCount: entries.length,
                };
              })
              .filter((group) => group.entries.length > 0) || [];
          // Build the Pages facet counts from the raw site-search hits so
          // the sidebar shows the full set of categories even when one is
          // currently selected (matches how Species / Types behave).
          const countMap = new Map<string, number>();
          for (const p of pages) {
            countMap.set(p.category, (countMap.get(p.category) || 0) + 1);
          }
          this.pageCategoryCounts = Array.from(countMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

          // Apply the user's Pages category filter (if any) before injecting
          // the Pages group into the results. When a Pages category is
          // selected, drop the biology groups entirely so the user only sees
          // the page hits they asked for.
          const selectedCats = this.filters.pageCategories || [];
          const biologyFilterActive = !!(
            this.filters.species?.length ||
            this.filters.types?.length ||
            this.filters.compartments?.length ||
            this.filters.keywords?.length
          );
          // Pages have no biology metadata, so any biology facet selection
          // means the user is narrowing to biology results — drop Pages.
          // Conversely, a Pages-category selection means the user is
          // narrowing to documentation — drop biology groups.
          const visiblePages = biologyFilterActive
            ? []
            : selectedCats.length
              ? pages.filter((p) => selectedCats.includes(p.category))
              : pages;
          if (selectedCats.length) {
            res.results = [];
          }

          // Append site-search hits as a "Pages" group at the bottom so
          // documentation/news/blog hits show up alongside biology entities.
          if (visiblePages.length) {
            const pageEntries = visiblePages.map((p) => ({
              dbId: -p.id,
              id: p.url,
              stId: p.url,
              name: p.title,
              referenceName: p.title,
              exactType: 'Pages',
              type: 'Pages',
              species: [],
              compartmentNames: [],
              summation: p.excerpt,
              pageCategory: p.category,
              pageUrl: p.url,
              pageExcerpt: p.excerpt,
            } as unknown as SearchEntry));
            res.results = [
              ...res.results,
              {
                typeName: 'Pages',
                entries: pageEntries,
                entriesCount: pageEntries.length,
              } as ResultGroup,
            ];
          }
          res.numberOfMatches = res.results.reduce(
            (sum, g) => sum + g.entries.length,
            0
          );
          this.results = res;
          this.facets = facets;
          this.totalPages = this.totalPages = Math.max(
            ...(results.results || []).map((group) =>
              Math.ceil((group.entriesCount || 0) / this.pageSize)
            ),
            0
          );
          this.hasNoResults =
            ((results as SearchResult).numberOfMatches || 0) === 0;
          this.error = '';

          // Reset per-group pagination state
          this.groupPages = {};
          this.groupPageEntries = {};
          this.groupLoading = {};
          this.expandedForms = {};

          // If there's a Protein group, fetch ALL protein entries for deduplication
          const proteinGroup = this.results.results.find(
            (g) => g.typeName === 'Protein'
          );
          if (proteinGroup && proteinGroup.entriesCount > 0) {
            this.fetchAllProteins(proteinGroup.entriesCount);
          } else {
            this.proteinForms = new Map();
            this.uniqueProteins = [];
            this.proteinTotalForms = 0;
          }
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Search error:', err);
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
    if (
      err.status === 404 &&
      err.error?.messages?.[0]?.includes('No entries found')
    ) {
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

  private fetchAllProteins(totalCount: number): void {
    this.proteinLoading = true;
    this.proteinForms = new Map();
    this.uniqueProteins = [];
    this.proteinTotalForms = 0;

    const batchSize = 500;
    const proteinFilters = { ...this.filters, types: ['Protein'] };

    const batchRequests: Observable<SearchResult | null>[] = [];
    for (let offset = 0; offset < totalCount; offset += batchSize) {
      const batchPage = Math.floor(offset / batchSize);
      batchRequests.push(
        this.searchService
          .search(this.query, proteinFilters, batchPage, batchSize)
          .pipe(catchError(() => of(null)))
      );
    }

    forkJoin(batchRequests).subscribe((results) => {
      const allProteins: SearchEntry[] = [];
      for (const result of results) {
        if (!result?.results?.length) continue;
        const group = result.results.find((g) => g.typeName === 'Protein');
        if (group) allProteins.push(...group.entries);
      }

      // Group by referenceIdentifier
      const formsMap = new Map<string, SearchEntry[]>();
      const representativeMap = new Map<string, SearchEntry>();

      for (const entry of allProteins) {
        const key = entry.referenceIdentifier || entry.id || entry.stId;
        if (!formsMap.has(key)) {
          formsMap.set(key, []);
          representativeMap.set(key, entry);
        }
        formsMap.get(key)!.push(entry);
      }

      this.proteinForms = formsMap;
      this.uniqueProteins = [...representativeMap.values()];
      this.proteinTotalForms = allProteins.length;
      this.proteinLoading = false;
    });
  }

  toggleForms(entry: SearchEntry): void {
    const key = entry.referenceIdentifier || entry.id || entry.stId;
    this.expandedForms[key] = !this.expandedForms[key];
  }

  getProteinForms(entry: SearchEntry): SearchEntry[] {
    const key = entry.referenceIdentifier || entry.id || entry.stId;
    return this.proteinForms.get(key) || [];
  }

  getProteinFormCount(entry: SearchEntry): number {
    return this.getProteinForms(entry).length;
  }

  isFormsExpanded(entry: SearchEntry): boolean {
    const key = entry.referenceIdentifier || entry.id || entry.stId;
    return !!this.expandedForms[key];
  }

  getSpriteClass(entry: SearchEntry): string {
    const reactionSubtypes = new Set([
      'association',
      'binding',
      'dissociation',
      'omitted',
      'transition',
      'uncertain',
      'depolymerisation',
      'polymerisation',
    ]);

    const rawType = (entry.exactType || entry.type || '').trim();
    const spriteType = reactionSubtypes.has(rawType.toLowerCase())
      ? 'Reaction'
      : rawType || 'Pathway';
    return `sprite sprite-resize sprite-${spriteType}`;
  }

  // Resolve the Reactome subject icon (Protein, Pathway, Complex, …) for a
  // search result so the row renders the same SVG icon as the pathway-browser
  // search.
  getSubjectIcon(entry: SearchEntry): SubjectIcon {
    return getSubjectIcon(entry.exactType || entry.type);
  }

  iconSvgUrl(entry: SearchEntry): string {
    return `${environment.host}/icon/${entry.stId}.svg`;
  }

  get allEntries(): SearchEntry[] {
    if (!this.results?.results) return [];
    return this.results.results.flatMap((g) =>
      this.filterDeletedEntries(g.entries)
    );
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

    this.updateQueryParams({
      [category]: current.length ? current : null,
      page: null,
    });
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

  collapseAllGroups(): void {
    for (const group of this.results?.results || []) {
      this.collapsedGroups[group.typeName] = true;
    }
  }

  expandAllGroups(): void {
    for (const group of this.results?.results || []) {
      this.collapsedGroups[group.typeName] = false;
    }
  }

  allGroupsCollapsed(): boolean {
    const groups = this.results?.results || [];
    if (!groups.length) return false;
    return groups.every((g) => this.collapsedGroups[g.typeName]);
  }

  // toggleAdvancedMode(): void {
  //   this.advancedMode = !this.advancedMode;
  // }

  private filterDeletedEntries(entries: SearchEntry[]): SearchEntry[] {
    if (!entries?.length) return [];

    const nonDeleted = entries.filter((e) => !e.deleted);
    if (nonDeleted.length > 0) {
      return nonDeleted;
    }

    return entries;
  }

  private updateQueryParams(
    params: Record<string, string | string[] | null>
  ): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  getFacetItems(
    facet: { selected: FacetCount[]; available: FacetCount[] } | undefined
  ): FacetCount[] {
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
      pageCategories: 'Pages',
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
    // Site-search hits carry their own absolute URL into pageUrl.
    if (entry.exactType === 'Pages') {
      return (entry as any).pageUrl || '/';
    }
    if (this.currentMode === 'reference') {
      const id = entry.id || entry.stId;
      if (entry.exactType === 'Interactor')
        return '/content/detail/interactor/' + id;
      if (entry.exactType === 'Icon') return '/content/detail/icon/' + id;
      return '/content/detail/' + id;
    }
    //Remove HTML tags from entry.stId if present
    entry.stId = entry.stId?.replace(/<[^>]*>/g, '');

    if (entry.exactType === 'Interactor')
      return '/content/detail/interactor/' + entry.stId;
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

  getReferencePageNumbers(): (number | '...')[] {
    return this.buildPageNumbers(this.currentPage, this.totalPages);
  }

  private buildPageNumbers(current: number, total: number): (number | '...')[] {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i);
    }

    const pages: (number | '...')[] = [0];

    if (current > 2) {
      pages.push('...');
    }

    const start = Math.max(1, current - 1);
    const end = Math.min(total - 2, current + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (current < total - 3) {
      pages.push('...');
    }

    pages.push(total - 1);
    return pages;
  }

  // Per-group pagination
  getGroupPage(group: ResultGroup): number {
    return this.groupPages[group.typeName] || 0;
  }

  getGroupTotalPages(group: ResultGroup): number {
    if (group.typeName === 'Protein') {
      return Math.ceil(this.uniqueProteins.length / this.groupPageSize) || 1;
    }
    return Math.ceil(group.entriesCount / this.groupPageSize);
  }

  getGroupPageEntries(group: ResultGroup): SearchEntry[] {
    if (group.typeName === 'Protein') {
      // While still loading all proteins, show nothing (loading message is displayed)
      if (this.proteinLoading) return [];
      const page = this.groupPages['Protein'] || 0;
      const start = page * this.groupPageSize;
      return this.uniqueProteins.slice(start, start + this.groupPageSize);
    }
    return (
      this.groupPageEntries[group.typeName] ||
      group.entries.slice(0, this.groupPageSize)
    );
  }

  goToGroupPage(group: ResultGroup, page: number): void {
    const total = this.getGroupTotalPages(group);
    if (page < 0 || page >= total) return;
    this.groupPages[group.typeName] = page;

    // Protein group is paginated client-side — no server call needed
    if (group.typeName === 'Protein') return;

    this.groupLoading[group.typeName] = true;
    this.searchService
      .search(
        this.query,
        { ...this.filters, types: [group.typeName] },
        page,
        this.groupPageSize
      )
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        this.groupLoading[group.typeName] = false;
        if (!result?.results?.length) return;
        this.groupPageEntries[group.typeName] = result.results[0].entries;
      });
  }

  getGroupPageNumbers(group: ResultGroup): (number | '...')[] {
    return this.buildPageNumbers(
      this.getGroupPage(group),
      this.getGroupTotalPages(group)
    );
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

    this.http.post(`${CONTENT_SERVICE}/contact`, formData).subscribe({
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
