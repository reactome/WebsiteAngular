import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, forkJoin } from 'rxjs';
import { PageLayoutComponent } from '../page-layout/page-layout.component';
import { TileComponent } from '../reactome-components/tile/tile.component';
import { SearchBarComponent } from './search-bar/search-bar.component';
import {
  SearchService,
  SearchResult,
  FacetResponse,
  SearchFilters,
  FacetCount,
} from '../../services/search.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [PageLayoutComponent, TileComponent, RouterLink, SearchBarComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private searchService = inject(SearchService);

  query = '';
  results: SearchResult | null = null;
  facets: FacetResponse | null = null;
  loading = false;
  error = '';

  currentPage = 0;
  pageSize = 30;
  totalPages = 0;

  filters: SearchFilters = {};

  collapsedFacets: Record<string, boolean> = {};
  collapsedGroups: Record<string, boolean> = {};

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

      if (this.query) {
        this.doSearch();
      }
    });
  }

  ngOnDestroy(): void {
    this.paramsSub?.unsubscribe();
  }

  private doSearch(): void {
    this.loading = true;
    this.error = '';

    forkJoin({
      results: this.searchService.search(this.query, this.filters, this.currentPage, this.pageSize),
      facets: this.searchService.getFacets(this.query, this.filters),
    }).subscribe({
      next: ({ results, facets }) => {
        this.results = results;
        this.facets = facets;
        this.totalPages = Math.ceil((results.numberOfMatches || 0) / this.pageSize);
        this.loading = false;
      },
      error: () => {
        this.error = 'An error occurred while searching. Please try again.';
        this.loading = false;
      },
    });
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
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
