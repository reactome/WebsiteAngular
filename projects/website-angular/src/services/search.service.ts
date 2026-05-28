import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CONTENT_SERVICE } from '../../../../projects/pathway-browser/src/environments/environment';

export interface SearchEntry {
  dbId: number;
  stId: string;
  id: string;
  name: string;
  type: string;
  exactType: string;
  species: string[];
  summation: string;
  compartmentNames: string[];
  isDisease: boolean;
  referenceName: string;
  referenceIdentifier: string;
  databaseName: string;
  referenceURL: string;
  deleted: boolean;
  date: number;
}

export interface ResultGroup {
  typeName: string;
  entries: SearchEntry[];
  entriesCount: number;
  rowCount: number;
}

export interface SearchResult {
  results: ResultGroup[];
  rowCount: number;
  numberOfMatches: number;
}

export interface FacetCount {
  name: string;
  count: number;
}

export interface Facet {
  selected: FacetCount[];
  available: FacetCount[];
}

export interface FacetResponse {
  totalNumFount: number;
  speciesFacet: Facet;
  typeFacet: Facet;
  keywordFacet: Facet;
  compartmentFacet: Facet;
}

export interface SearchFilters {
  species?: string[];
  types?: string[];
  compartments?: string[];
  keywords?: string[];
  // Client-side filter for the merged site-search "Pages" group. Values are
  // page categories (e.g. "News", "Documentation").
  pageCategories?: string[];
}

import { APP_CONFIG } from '../config/config';

@Injectable({
  providedIn: 'root',
})
export class SearchService {
  private http = inject(HttpClient);
  private baseUrl = `${CONTENT_SERVICE}/search`;

  search(
    query: string,
    filters: SearchFilters = {},
    page: number = 0,
    rows: number = 30
  ): Observable<SearchResult> {
    const params = this.buildParams(query, filters, page, rows);
    return this.http.get<SearchResult>(`${this.baseUrl}/query`, { params });
  }

  getFacets(
    query: string,
    filters: SearchFilters = {}
  ): Observable<FacetResponse> {
    const params = this.buildParams(query, filters);
    return this.http.get<FacetResponse>(`${this.baseUrl}/facet_query`, {
      params,
    });
  }

  getAllFacets(): Observable<FacetResponse> {
    return this.http.get<FacetResponse>(`${this.baseUrl}/facet`);
  }

  getSuggestedTerms(query: string): Observable<string[]> {
    return this.http.get<string[]>(
      `${this.baseUrl}/suggest?query=${encodeURIComponent(query)}`
    );
  }

  getSpellCheckTerms(query: string): Observable<string[]> {
    return this.http.get<string[]>(
      `${this.baseUrl}/spellcheck?query=${encodeURIComponent(query)}`
    );
  }

  private buildParams(
    query: string,
    filters: SearchFilters,
    page?: number,
    rows?: number
  ): HttpParams {
    let params = new HttpParams().set('query', query).set('cluster', 'true');

    if (filters.species?.length) {
      for (const s of filters.species) {
        params = params.append('species', s);
      }
    }
    if (filters.types?.length) {
      for (const t of filters.types) {
        params = params.append('types', t);
      }
    }
    if (filters.compartments?.length) {
      for (const c of filters.compartments) {
        params = params.append('compartments', c);
      }
    }
    if (filters.keywords?.length) {
      for (const k of filters.keywords) {
        params = params.append('keywords', k);
      }
    }

    if (page != null && rows != null) {
      params = params.set('Start row', (page * rows).toString());
      params = params.set('rows', rows.toString());
    }

    return params;
  }
}
