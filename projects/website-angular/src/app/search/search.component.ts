import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  ElementRef,
  ChangeDetectorRef,
  viewChild,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin, catchError, map, Observable } from 'rxjs';
import { of } from 'rxjs';
import { IconService } from '../../services/icon.service';
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
import { ChallengeWidget, renderWidget } from './answer/turnstile';

/** Our own route: ContentService's /contact takes only an hCaptcha token. */
const CONTACT_ROUTE = '/contact';
import { SearchAnswerComponent } from './answer/search-answer.component';

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
    SearchAnswerComponent,
  ],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy {
  private icons = inject(IconService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private searchService = inject(SearchService);
  private siteSearch = inject(SiteSearchService);
  private http = inject(HttpClient);
  // This component keeps its state in plain fields (Records and Maps mutated
  // in place), not signals, so nothing tells Angular when an async callback
  // changes it. Under zones that worked by accident -- zone.js re-checked the
  // whole tree after every completed XHR. Zoneless needs the notification to be
  // explicit, hence markForCheck() at each async boundary below. Converting all
  // ~20 fields to signals would be the idiomatic fix, but that is a rewrite of
  // this component rather than a refactor.
  private cdr = inject(ChangeDetectorRef);

  // Optional: the container is drawn only on the no-results form, inside an
  // @if. It was declared `!`, which the query migration read as "required",
  // and a required query throws (NG0951) wherever the form is not shown.
  readonly captchaContainer = viewChild<ElementRef<HTMLDivElement>>('captchaContainer');

  captchaToken: string | null = null;
  private challenge?: ChallengeWidget;
  private challengeSub?: Subscription;
  /** A message is on its way: Send waits for its answer, so it goes once. */
  contactSending = false;

  constructor() {
    // A widget per form: a search that finds nothing again draws a new form,
    // whose container had no challenge when it was drawn only once.
    effect(() => {
      const container = this.captchaContainer()?.nativeElement;
      untracked(() => this.prepareChallenge(container));
    });
  }

  query = '';
  searchSubmitted = false;
  onQueryInput(newQuery: string): void {
    this.query = newQuery;
    this.getSuggestions(newQuery);
    this.searchSubmitted = false;
    // This component keeps its state in plain fields, and the app is zoneless,
    // so a write here tells Angular nothing on its own -- see the note at the
    // top of the class. Without this, `searchSubmitted = false` does not close
    // the `@if` that depends on it, and whatever is inside keeps whatever state
    // it had. That is how one query's answer came to sit above another query's
    // results.
    this.cdr.markForCheck();
  }
  suggestedTerms: string[] = [];
  results: SearchResult | null = null;
  facets: FacetResponse | null = null;
  loading = false;
  error = '';
  hasNoResults = false;
  formSubmitted = false;
  /** The help-desk message could not be sent; the form stays, with what was written. */
  contactFailed = false;
  /**
   * The form cannot be sent from here: this deployment does not send, or the
   * check that the reader is a person could not be loaded.
   */
  contactUnavailable = false;
  /**
   * Email and message are filled in. Held as a signal set on input: the button
   * read the fields directly, and with nothing to re-check it when they were
   * typed in, solving the captcha first left Send disabled for good.
   */
  readonly contactReady = signal(false);

  currentPage = 0;
  pageSize = 30;
  totalPages = 0;

  filters: SearchFilters = {};

  grouped = true;

  // Filter panel visibility. Defaults to visible on desktop; on narrow
  // screens the user can collapse it via the toggle button.
  // Default to the sidebar being open on wide layouts and collapsed on
  // narrow layouts (kept in sync with the 1024px breakpoint in the
  // component scss — see the .filters-toggle-btn / .facet-sidebar
  // @media (max-width: 1024px) block).
  filtersVisible = typeof window === 'undefined' || window.innerWidth > 1024;

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
  /** Some batches of the protein list failed, so it is short of them. */
  proteinsIncomplete = false;
  /** Groups whose last page change failed, and stayed on the page they show. */
  groupPageFailed: Record<string, boolean> = {};
  /** The website's pages could not be searched; only data results are shown. */
  pagesFailed = false;

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
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.paramsSub?.unsubscribe();
    this.cancelSearchRequests();
    this.prepareChallenge(undefined);
  }

  /** Requests of an earlier search, which must not write into this one. */
  private searchSub?: Subscription;
  private proteinSub?: Subscription;
  private groupPageSubs: Record<string, Subscription> = {};

  private cancelSearchRequests(): void {
    this.searchSub?.unsubscribe();
    this.proteinSub?.unsubscribe();
    this.proteinLoading = false;
    Object.values(this.groupPageSubs).forEach((sub) => sub.unsubscribe());
    this.groupPageSubs = {};
  }

  private getSuggestions(query: string): void {
    if (!query) {
      this.suggestedTerms = [];
      return;
    }
    this.searchService.getSpellCheckTerms(query).subscribe({
      next: (terms) => {
        this.suggestedTerms = terms || [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.suggestedTerms = [];
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Readies the help form drawn into `container`, or clears up after the one
   * that has gone. The reader proves they are a person with Turnstile, whose
   * sitekey comes from the route the message goes to: a deployment that cannot
   * send says so there.
   */
  private prepareChallenge(container: HTMLDivElement | undefined): void {
    // Whatever the last form's challenge said does not belong to this one, and
    // its widget must not go on writing into this form's token.
    this.challengeSub?.unsubscribe();
    this.challenge?.remove();
    this.challenge = undefined;
    this.captchaToken = null;
    this.contactUnavailable = false;
    if (!container) return;
    const unavailable = (error: unknown) => {
      console.error('The help form cannot be sent from here', error);
      if (this.captchaContainer()?.nativeElement !== container) return;
      this.contactUnavailable = true;
      this.cdr.markForCheck();
    };
    this.challengeSub = this.http.get<{ sitekey: string }>(CONTACT_ROUTE).subscribe({
      next: ({ sitekey }) =>
        void renderWidget(container, sitekey, (token) => {
          this.captchaToken = token;
          this.cdr.markForCheck();
        }).then((widget) => {
          // Gone already: a later search replaced the form while this loaded.
          if (this.captchaContainer()?.nativeElement !== container) widget.remove();
          else this.challenge = widget;
        }, unavailable),
      error: unavailable,
    });
  }

  private doSearch(): void {
    this.cancelSearchRequests();
    this.loading = true;
    this.error = '';
    this.hasNoResults = false;
    // A new search shows a new help form, if any.
    this.formSubmitted = false;
    this.contactFailed = false;
    this.contactReady.set(false);
    this.groupLoading = {};

    this.searchSub = forkJoin({
      results: this.searchService
        .search(this.query, this.filters, this.currentPage, this.pageSize)
        .pipe(catchError((err) => this.handleSearchError(err))),
      facets: this.searchService
        .getFacets(this.query, this.filters)
        .pipe(catchError(() => of(null))),
      pages: this.siteSearch.search(this.query).pipe(
        map((hits) => ({ hits, failed: false })),
        catchError(() => of({ hits: [] as SitePageHit[], failed: true }))
      ),
    }).subscribe({
      next: ({ results, facets, pages: { hits: pages, failed: pagesFailed } }) => {
        this.pagesFailed = pagesFailed;
        // If either API call failed, show error
        if (!results || !facets) {
          this.error = 'An error occurred while searching. Please try again.';
          this.results = null;
          this.facets = null;
          this.hasNoResults = false;
        } else {
          // Successful API response - check if we have results
          const res = results as SearchResult;
          // Solr's true total across the whole result set; per-group
          // pagination chops each `group.entries` down to ~30, so we
          // must NOT recompute this from entries.length later.
          const biologyTotal = res.numberOfMatches ?? 0;
          const hasNonDeleted = res.results?.some((group) => group.entries.some((e) => !e.deleted));
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
            const pageEntries = visiblePages.map(
              (p) =>
                ({
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
                }) as unknown as SearchEntry
            );
            res.results = [
              ...res.results,
              {
                typeName: 'Pages',
                entries: pageEntries,
                entriesCount: pageEntries.length,
              } as ResultGroup,
            ];
          }
          // Keep Solr's biology total; add Pages count (when shown); zero
          // out biology when the user selected a Pages-only filter.
          res.numberOfMatches = (selectedCats.length ? 0 : biologyTotal) + visiblePages.length;
          this.results = res;
          this.facets = facets;
          this.totalPages = this.totalPages = Math.max(
            ...(results.results || []).map((group) =>
              Math.ceil((group.entriesCount || 0) / this.pageSize)
            ),
            0
          );
          this.hasNoResults = ((results as SearchResult).numberOfMatches || 0) === 0;
          this.error = '';

          // Reset per-group pagination state
          this.groupPages = {};
          this.groupPageEntries = {};
          this.groupLoading = {};
          this.groupPageFailed = {};
          this.expandedForms = {};

          // If there's a Protein group, fetch ALL protein entries for deduplication
          const proteinGroup = this.results.results.find((g) => g.typeName === 'Protein');
          if (proteinGroup && proteinGroup.entriesCount > 0) {
            this.fetchAllProteins(proteinGroup.entriesCount);
          } else {
            this.proteinForms = new Map();
            this.uniqueProteins = [];
            this.proteinTotalForms = 0;
          }
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Search error:', err);
        this.error = 'An error occurred while searching. Please try again.';
        this.hasNoResults = false;
        this.results = null;
        this.facets = null;
        this.loading = false;
        this.cdr.markForCheck();
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

  private fetchAllProteins(totalCount: number): void {
    this.proteinLoading = true;
    this.proteinsIncomplete = false;
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
          .pipe(catchError((err) => this.handleSearchError(err)))
      );
    }

    this.proteinSub = forkJoin(batchRequests).subscribe((results) => {
      // null is a batch that failed, rather than one that found nothing.
      this.proteinsIncomplete = results.some((result) => result === null);
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
      this.cdr.markForCheck();
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

  // Resolve the Reactome subject icon (Protein, Pathway, Complex, …) for a
  // search result so the row renders the same SVG icon as the pathway-browser
  // search.
  getSubjectIcon(entry: SearchEntry): SubjectIcon {
    return getSubjectIcon(entry.exactType || entry.type);
  }

  iconSvgUrl(entry: SearchEntry): string {
    return this.icons.iconUrl(entry.stId);
  }

  /**
   * Not every search hit that looks like an icon has an SVG behind it, and a
   * broken image box next to a result reads as a broken page. Hide the image
   * and let the rest of the result stand on its own.
   *
   * The template has always called this; until strictTemplates was switched on
   * nothing noticed that it did not exist, so a failed icon load threw instead.
   */
  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (img) img.style.display = 'none';
  }

  get allEntries(): SearchEntry[] {
    if (!this.results?.results) return [];
    return this.results.results.flatMap((g) => this.filterDeletedEntries(g.entries));
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

  private updateQueryParams(params: Record<string, string | string[] | null>): void {
    void this.router.navigate([], {
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
      if (entry.exactType === 'Interactor') return '/content/detail/interactor/' + id;
      if (entry.exactType === 'Icon') return '/content/detail/icon/' + id;
      return '/content/detail/' + id;
    }
    //Remove HTML tags from entry.stId if present
    entry.stId = entry.stId?.replace(/<[^>]*>/g, '');

    if (entry.exactType === 'Interactor') return '/content/detail/interactor/' + entry.stId;
    if (entry.exactType === 'Icon') return '/content/detail/icon/' + entry.stId;
    return '/content/detail/' + entry.stId;
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(0, this.currentPage - Math.floor(maxVisible / 2));
    const end = Math.min(this.totalPages, start + maxVisible);

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
    if (group.typeName === 'Pages') {
      const start = (this.groupPages['Pages'] || 0) * this.groupPageSize;
      return group.entries.slice(start, start + this.groupPageSize);
    }
    return this.groupPageEntries[group.typeName] || group.entries.slice(0, this.groupPageSize);
  }

  goToGroupPage(group: ResultGroup, page: number): void {
    const total = this.getGroupTotalPages(group);
    if (page < 0 || page >= total) return;

    // Protein and Pages groups are paginated client-side — no server call
    // needed, and Pages are not in the search service to be asked for.
    if (group.typeName === 'Protein' || group.typeName === 'Pages') {
      this.groupPages[group.typeName] = page;
      return;
    }

    // Only the last page asked for may answer.
    this.groupPageSubs[group.typeName]?.unsubscribe();
    this.groupLoading[group.typeName] = true;
    this.groupPageSubs[group.typeName] = this.searchService
      .search(this.query, { ...this.filters, types: [group.typeName] }, page, this.groupPageSize)
      .pipe(catchError((err) => this.handleSearchError(err)))
      .subscribe((result) => {
        this.groupLoading[group.typeName] = false;
        // Failed, or empty although the count said otherwise: the page number
        // stays on the entries still shown.
        const entries = result?.results?.[0]?.entries;
        this.groupPageFailed[group.typeName] = !entries?.length;
        if (!entries?.length) {
          this.cdr.markForCheck();
          return;
        }
        // The number moves with the entries, not ahead of them.
        this.groupPages[group.typeName] = page;
        this.groupPageEntries[group.typeName] = entries;
        this.cdr.markForCheck();
      });
  }

  getGroupPageNumbers(group: ResultGroup): (number | '...')[] {
    return this.buildPageNumbers(this.getGroupPage(group), this.getGroupTotalPages(group));
  }

  submitContactForm(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.captchaToken || this.contactSending) {
      return;
    }

    const form = new FormData(event.target as HTMLFormElement);
    const field = (name: string) => String(form.get(name) ?? '');
    const message = {
      contactName: field('contactName'),
      mailAddress: field('mailAddress'),
      subject: field('subject'),
      message: field('message'),
      token: this.captchaToken,
    };

    this.contactFailed = false;
    this.contactSending = true;
    // A token is good for one try; this one is spent whatever the answer.
    this.captchaToken = null;
    this.http.post(CONTACT_ROUTE, message).subscribe({
      next: () => {
        this.contactSending = false;
        this.formSubmitted = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.contactSending = false;
        console.error('Error submitting contact form:', err);
        // Not sent, so not thanked for: the form stays, with what was written,
        // and a fresh challenge, as a token is good for one try.
        this.contactFailed = true;
        this.challenge?.reset();
        this.cdr.markForCheck();
      },
    });
  }
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
