import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import {
  ContentDataService,
  TocPathway,
  SimplePerson,
} from '../../../services/content-data.service';

type SortKey = 'displayName' | 'releaseDate';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-toc',
  imports: [PageLayoutComponent],
  templateUrl: './toc.component.html',
  styleUrl: './toc.component.scss',
})
export class TocComponent implements OnInit, OnDestroy {
  private contentDataService = inject(ContentDataService);

  // Async callbacks assign to plain fields, so Angular has to be told
  // explicitly that the view needs re-rendering.
  private cdr = inject(ChangeDetectorRef);
  loading = true;
  error = false;

  allPathways: TocPathway[] = [];
  filteredPathways: TocPathway[] = [];
  searchQuery = '';
  statusFilter: '' | 'NEW' | 'UPDATED' = '';
  sortKey: SortKey = 'displayName';
  sortDir: SortDir = 'asc';
  expandedStIds = new Set<string>();

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.applyFilter();
      });

    this.loadData();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * `stId` -> DOI, for the subpathways whose DOI the table of contents cannot
   * see on its own.
   *
   * `/data/content/toc` sends three fields for a child -- `stId`, `displayName`,
   * `speciesName` -- and no `doi`, measured over all 215 children it returns.
   * The template has always rendered a DOI link for a child behind
   * `@if (sub.doi)`, so that link could never appear.
   *
   * It is not markup for a case that never existed. Production's own
   * `/content/toc` carries **44 DOIs, of which 41 are subpathways** -- so all
   * but three of the DOIs a reader expects on this page were missing here, with
   * nothing logged and nothing to notice.
   *
   * `/data/content/doi` lists every pathway that has one (669 of them, 107
   * matching a child in this table), so the join is done here rather than
   * waiting on the endpoint's child projection to grow a field. If it ever does,
   * `sub.doi` will win on its own and this lookup will quietly stop mattering.
   */
  private doiByStId = new Map<string, string>();

  doiFor(pathway: { stId: string; doi?: string | null }): string | null {
    return pathway.doi ?? this.doiByStId.get(pathway.stId) ?? null;
  }

  loadData() {
    this.loading = true;
    this.error = false;
    this.contentDataService.getTocPathways().subscribe({
      next: (data) => {
        this.allPathways = data;
        this.filteredPathways = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = true;
        this.loading = false;
        this.cdr.markForCheck();
      },
    });

    // Separately, and deliberately not blocking the table: the DOI list is the
    // larger request of the two, and a reader wants the contents before they
    // want a citation link. A failure here costs the links and nothing else.
    this.contentDataService
      .getDoiPathways()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.doiByStId = new Map(
            rows.filter((row) => row.doi).map((row) => [row.stId, row.doi as string])
          );
          this.cdr.markForCheck();
        },
        error: (err) => {
          // Said out loud rather than swallowed. The whole reason this fix
          // exists is that missing DOI links look exactly like pathways that
          // have no DOI -- nothing thrown, nothing logged, nothing to notice.
          // A silent catch here would rebuild that.
          console.error('Could not load DOIs for the table of contents:', err);
        },
      });
  }

  onSearchInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  clearSearch() {
    this.searchQuery = '';
    this.applyFilter();
  }

  setStatusFilter(status: '' | 'NEW' | 'UPDATED') {
    this.statusFilter = this.statusFilter === status ? '' : status;
    this.applyFilter();
  }

  applyFilter() {
    const q = this.searchQuery.toLowerCase().trim();
    let results = this.allPathways;

    if (this.statusFilter) {
      results = results.filter((p) => p.releaseStatus === this.statusFilter);
    }

    if (q) {
      results = results.filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.species?.toLowerCase().includes(q) ||
          p.doi?.toLowerCase().includes(q) ||
          this.personsMatch(p.authors, q) ||
          this.personsMatch(p.reviewers, q) ||
          this.personsMatch(p.editors, q) ||
          p.subpathways?.some((s) => s.displayName.toLowerCase().includes(q))
      );
    }

    this.filteredPathways = this.sortList(results);
  }

  toggleSort(key: SortKey) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
    this.filteredPathways = this.sortList(this.filteredPathways);
  }

  sortIcon(key: SortKey): string {
    if (this.sortKey !== key) return 'unfold_more';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortList(list: TocPathway[]): TocPathway[] {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = (a[this.sortKey] || '').toLowerCase();
      const vb = (b[this.sortKey] || '').toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }

  private personsMatch(persons: SimplePerson[], q: string): boolean {
    return persons?.some(
      (p) =>
        p.displayName?.toLowerCase().includes(q) ||
        p.surname?.toLowerCase().includes(q) ||
        p.firstname?.toLowerCase().includes(q)
    );
  }

  toggleExpand(stId: string) {
    if (this.expandedStIds.has(stId)) {
      this.expandedStIds.delete(stId);
    } else {
      this.expandedStIds.add(stId);
    }
  }

  isExpanded(stId: string): boolean {
    return this.expandedStIds.has(stId);
  }

  personNames(persons: SimplePerson[]): string {
    if (!persons?.length) return '';
    return persons.map((p) => p.displayName).join(', ');
  }

  personUrl(person: SimplePerson): string {
    return `/content/detail/person/${person.orcidId || person.dbId}`;
  }

  doiUrl(doi: string): string {
    return `https://doi.org/${doi}`;
  }

  get resultCount(): number {
    return this.filteredPathways.length;
  }

  get newCount(): number {
    return this.allPathways.filter((p) => p.releaseStatus === 'NEW').length;
  }

  get updatedCount(): number {
    return this.allPathways.filter((p) => p.releaseStatus === 'UPDATED').length;
  }
}
