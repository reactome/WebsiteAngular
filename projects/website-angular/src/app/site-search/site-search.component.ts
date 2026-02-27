import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import MiniSearch from 'minisearch';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { SiteSearchIndexItem } from '../../types/site-search';

interface SearchResultItem extends SiteSearchIndexItem {
  score: number;
}

interface GroupedResults {
  category: string;
  items: SearchResultItem[];
}

@Component({
  selector: 'app-site-search',
  standalone: true,
  imports: [PageLayoutComponent, RouterLink],
  templateUrl: './site-search.component.html',
  styleUrl: './site-search.component.scss',
})
export class SiteSearchComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);

  private miniSearch: MiniSearch<SiteSearchIndexItem> | null = null;
  private allItems: SearchResultItem[] = [];
  private paramsSub!: Subscription;

  query = '';
  results: SearchResultItem[] = [];
  groupedResults: GroupedResults[] = [];
  totalCategoryCounts: { category: string; count: number }[] = [];
  categoryCounts: { category: string; count: number }[] = [];
  activeCategory: string | null = null;
  expandedGroups: Set<string> = new Set();
  previewLimit = 5;
  loading = true;
  indexLoaded = false;
  searched = false;
  totalCount = 0;

  ngOnInit(): void {
    this.loadIndex();
    this.paramsSub = this.route.queryParams.subscribe((params) => {
      const q = params['q'] || '';
      if (q !== this.query) {
        this.query = q;
        if (this.indexLoaded) {
          this.doSearch();
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.paramsSub?.unsubscribe();
  }

  private loadIndex(): void {
    this.http.get<SiteSearchIndexItem[]>('/site-search-index.json').subscribe({
      next: (items) => {
        this.miniSearch = new MiniSearch<SiteSearchIndexItem>({
          fields: ['title', 'body'],
          storeFields: ['title', 'category', 'url', 'excerpt', 'date'],
          searchOptions: {
            boost: { title: 3 },
            fuzzy: 0.2,
            prefix: true,
          },
        });
        this.miniSearch.addAll(items);
        this.indexLoaded = true;
        this.loading = false;

        // Store all items for browsing without a query
        this.allItems = items.map((item) => ({ ...item, score: 0 }));
        this.totalCount = items.length;

        // Build total category counts from full index
        const countMap = new Map<string, number>();
        for (const item of items) {
          countMap.set(item.category, (countMap.get(item.category) || 0) + 1);
        }
        this.totalCategoryCounts = Array.from(countMap.entries())
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count);

        // Show all results by default
        this.doSearch();
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query = value;
    this.doSearch();
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.updateUrl();
  }

  filterByCategory(category: string | null): void {
    this.activeCategory = category;
    this.buildGroupedResults();
  }

  isExpanded(category: string): boolean {
    return this.expandedGroups.has(category);
  }

  toggleExpand(category: string): void {
    if (this.expandedGroups.has(category)) {
      this.expandedGroups.delete(category);
    } else {
      this.expandedGroups.add(category);
    }
  }

  getVisibleItems(group: GroupedResults): SearchResultItem[] {
    if (this.expandedGroups.has(group.category)) {
      return group.items;
    }
    return group.items.slice(0, this.previewLimit);
  }

  private doSearch(): void {
    if (!this.miniSearch) return;

    this.searched = !!this.query.trim();
    this.expandedGroups.clear();

    if (!this.query.trim()) {
      // No query — show all items
      this.results = this.allItems;
      this.categoryCounts = this.totalCategoryCounts;
    } else {
      // Search with query
      const raw = this.miniSearch.search(this.query.trim());
      this.results = raw.map((r) => ({
        id: r.id as number,
        title: r['title'],
        category: r['category'],
        url: r['url'],
        body: r['body'] || '',
        excerpt: r['excerpt'],
        date: r['date'],
        score: r.score,
      }));

      // Build category counts from search results
      const countMap = new Map<string, number>();
      for (const item of this.results) {
        countMap.set(item.category, (countMap.get(item.category) || 0) + 1);
      }
      this.categoryCounts = Array.from(countMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
    }

    // Reset filter if the active category has no results
    if (
      this.activeCategory &&
      !this.results.some((r) => r.category === this.activeCategory)
    ) {
      this.activeCategory = null;
    }

    this.buildGroupedResults();
  }

  private buildGroupedResults(): void {
    const filtered = this.activeCategory
      ? this.results.filter((item) => item.category === this.activeCategory)
      : this.results;

    const groups = new Map<string, SearchResultItem[]>();
    for (const item of filtered) {
      const existing = groups.get(item.category);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(item.category, [item]);
      }
    }

    this.groupedResults = Array.from(groups.entries()).map(
      ([category, items]) => ({
        category,
        items,
      })
    );
  }

  private updateUrl(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: this.query.trim() || null },
      queryParamsHandling: 'merge',
    });
  }
}
