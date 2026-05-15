import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { PageLayoutComponent } from '../../page-layout/page-layout.component';
import { ContentDataService, Contributor } from '../../../services/content-data.service';

type SortKey = 'displayName' | 'authoredPathways' | 'reviewedPathways' | 'authoredReactions' | 'reviewedReactions';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

@Component({
  selector: 'app-contributors',
  imports: [PageLayoutComponent],
  templateUrl: './contributors.component.html',
  styleUrl: './contributors.component.scss'
})
export class ContributorsComponent implements OnInit, OnDestroy {
  loading = true;
  error = false;

  allContributors: Contributor[] = [];
  filteredContributors: Contributor[] = [];
  pagedContributors: Contributor[] = [];

  searchQuery = '';
  activeLetter = '';
  sortKey: SortKey = 'displayName';
  sortDir: SortDir = 'asc';
  currentPage = 1;

  letters = LETTERS;

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(private contentDataService: ContentDataService) {}

  ngOnInit() {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.activeLetter = '';
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
    this.contentDataService.getContributors().subscribe({
      next: (data) => {
        this.allContributors = data;
        this.applyFilter();
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
    this.activeLetter = '';
    this.applyFilter();
  }

  selectLetter(letter: string) {
    this.searchQuery = '';
    this.activeLetter = this.activeLetter === letter ? '' : letter;
    this.applyFilter();
  }

  selectAll() {
    this.activeLetter = '';
    this.searchQuery = '';
    this.applyFilter();
  }

  applyFilter() {
    let results = this.allContributors;

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      results = results.filter(c =>
        c.person.displayName?.toLowerCase().includes(q) ||
        c.person.surname?.toLowerCase().includes(q) ||
        c.person.firstname?.toLowerCase().includes(q) ||
        c.person.orcidId?.toLowerCase().includes(q)
      );
    } else if (this.activeLetter) {
      results = results.filter(c => {
        const surname = c.person.surname || c.person.displayName || '';
        return surname.toUpperCase().startsWith(this.activeLetter);
      });
    }

    this.filteredContributors = this.sortList(results);
    this.currentPage = 1;
    this.updatePage();
  }

  toggleSort(key: SortKey) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = key === 'displayName' ? 'asc' : 'desc';
    }
    this.filteredContributors = this.sortList(this.filteredContributors);
    this.updatePage();
  }

  sortIcon(key: SortKey): string {
    if (this.sortKey !== key) return 'unfold_more';
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortList(list: Contributor[]): Contributor[] {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (this.sortKey === 'displayName') {
        const va = (a.person.surname || a.person.displayName || '').toLowerCase();
        const vb = (b.person.surname || b.person.displayName || '').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
      }
      const va = (a as any)[this.sortKey] || 0;
      const vb = (b as any)[this.sortKey] || 0;
      return (va - vb) * dir;
    });
  }

  updatePage() {
    const start = (this.currentPage - 1) * PAGE_SIZE;
    this.pagedContributors = this.filteredContributors.slice(start, start + PAGE_SIZE);
  }

  get maxPage(): number {
    return Math.ceil(this.filteredContributors.length / PAGE_SIZE) || 1;
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

  personUrl(person: { dbId: number; orcidId?: string }): string {
    // Prefer the ORCID in the URL (matches production reactome.org's
    // /content/detail/person/<orcid> format); fall back to dbId when a
    // person has no ORCID recorded. The /content/detail/person/:id
    // route accepts both.
    return `/content/detail/person/${person.orcidId || person.dbId}`;
  }

  orcidUrl(orcidId: string): string {
    return `https://orcid.org/${orcidId}`;
  }

  get resultCount(): number {
    return this.filteredContributors.length;
  }
}
