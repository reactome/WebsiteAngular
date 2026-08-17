import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { ContentDataService, DoiPathway, SimplePerson } from '../../../services/content-data.service';

type SortKey = 'displayName' | 'doi' | 'releaseDate' | 'species';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

@Component({
  selector: 'app-doi',
  imports: [PageLayoutComponent],
  templateUrl: './doi.component.html',
  styleUrl: './doi.component.scss'
})
export class DoiComponent implements OnInit, OnDestroy {
  private contentDataService = inject(ContentDataService);

  // Async callbacks assign to plain fields, so Angular has to be told
  // explicitly that the view needs re-rendering.
  private cdr = inject(ChangeDetectorRef);
  loading = true;
  error = false;

  allPathways: DoiPathway[] = [];
  filteredPathways: DoiPathway[] = [];
  pagedPathways: DoiPathway[] = [];

  searchQuery = '';
  statusFilter: '' | 'NEW' | 'UPDATED' = '';
  sortKey: SortKey = 'displayName';
  sortDir: SortDir = 'asc';
  currentPage = 1;

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

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
    this.contentDataService.getDoiPathways().subscribe({
      next: (data) => {
        this.allPathways = data;
        this.applyFilter();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = true;
        this.loading = false;
        this.cdr.markForCheck();
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
        this.personsMatch(p.editors, q)
      );
    }
    this.filteredPathways = this.sortList(results);
    this.currentPage = 1;
    this.updatePage();
  }

  private personsMatch(persons: SimplePerson[], q: string): boolean {
    return persons?.some(p =>
      p.displayName?.toLowerCase().includes(q) ||
      p.surname?.toLowerCase().includes(q) ||
      p.firstname?.toLowerCase().includes(q)
    );
  }

  toggleSort(key: SortKey) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
    this.filteredPathways = this.sortList(this.filteredPathways);
    this.updatePage();
  }

  sortIcon(key: SortKey): string {
    if (this.sortKey !== key) return 'unfold_more';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortList(list: DoiPathway[]): DoiPathway[] {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = (a[this.sortKey] || '').toLowerCase();
      const vb = (b[this.sortKey] || '').toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }

  updatePage() {
    const start = (this.currentPage - 1) * PAGE_SIZE;
    this.pagedPathways = this.filteredPathways.slice(start, start + PAGE_SIZE);
  }

  get maxPage(): number {
    return Math.ceil(this.filteredPathways.length / PAGE_SIZE) || 1;
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePage();
    }
  }

  nextPage() {
    if (this.currentPage < this.maxPage) {
      this.currentPage++;
      this.updatePage();
    }
  }

  personNames(persons: SimplePerson[]): string {
    if (!persons?.length) return '';
    return persons.map(p => p.displayName).join(', ');
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
    return this.allPathways.filter(p => p.releaseStatus === 'NEW').length;
  }

  get updatedCount(): number {
    return this.allPathways.filter(p => p.releaseStatus === 'UPDATED').length;
  }
}
