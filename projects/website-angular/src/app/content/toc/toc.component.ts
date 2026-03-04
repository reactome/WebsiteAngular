import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { ContentDataService, TocPathway, SimplePerson } from '../../../services/content-data.service';

type SortKey = 'displayName' | 'releaseDate';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-toc',
  imports: [PageLayoutComponent],
  templateUrl: './toc.component.html',
  styleUrl: './toc.component.scss'
})
export class TocComponent implements OnInit, OnDestroy {
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

  constructor(private contentDataService: ContentDataService) {}

  ngOnInit() {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.applyFilter();
    });

    this.loadData();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData() {
    this.loading = true;
    this.error = false;
    this.contentDataService.getTocPathways().subscribe({
      next: (data) => {
        this.allPathways = data;
        this.filteredPathways = data;
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
      }
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
      results = results.filter(p => p.releaseStatus === this.statusFilter);
    }

    if (q) {
      results = results.filter(p =>
        p.displayName.toLowerCase().includes(q) ||
        p.species?.toLowerCase().includes(q) ||
        p.doi?.toLowerCase().includes(q) ||
        this.personsMatch(p.authors, q) ||
        this.personsMatch(p.reviewers, q) ||
        this.personsMatch(p.editors, q) ||
        p.subpathways?.some(s => s.displayName.toLowerCase().includes(q))
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
    return persons?.some(p =>
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
    return persons.map(p => p.displayName).join(', ');
  }

  personUrl(person: SimplePerson): string {
    return `/content/detail/person/${person.dbId}`;
  }

  doiUrl(doi: string): string {
    return `https://doi.org/${doi}`;
  }

  get resultCount(): number {
    return this.filteredPathways.length;
  }

  get newCount(): number {
    return this.allPathways.filter(p => p.releaseStatus === 'NEW').length;
  }

  get updatedCount(): number {
    return this.allPathways.filter(p => p.releaseStatus === 'UPDATED').length;
  }
}
