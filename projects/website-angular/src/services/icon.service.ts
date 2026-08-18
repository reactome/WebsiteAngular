import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CONTENT_SERVICE } from '../../../pathway-browser/src/environments/environment';

export interface IconCategory {
  name: string;
  count: number;
}

export interface IconFacet {
  selected: IconCategory[];
  available: IconCategory[];
}

export interface IconFacetResponse {
  totalNumFount: number;
  iconCategoriesFacet: IconFacet;
}

export interface IconPhysicalEntity {
  stId: string;
  type: string;
  name: string;
  compartments: string;
  displayName: string;
}

export interface IconEntry {
  stId: string;
  name: string;
  iconName: string;
  iconCategories: string[];
  iconReferences: string[];
  iconEhlds: string[];
  iconPhysicalEntities: IconPhysicalEntity[];
  summation: string;
  exactType: string;
  iconCuratorName?: string;
  iconCuratorOrcidId?: string;
  iconDesignerName?: string;
  iconDesignerUrl?: string;
}

export interface IconResult {
  entries: IconEntry[];
  entriesCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class IconService {
  private http = inject(HttpClient);
  private baseUrl = `${CONTENT_SERVICE}/search`;

  getFacets(): Observable<IconFacetResponse> {
    return this.http.get<IconFacetResponse>(`${this.baseUrl}/icon/facet`);
  }

  queryIcons(
    options: { query?: string; category?: string; page?: number; pageSize?: number } = {}
  ): Observable<IconResult> {
    let params = new HttpParams();
    if (options.query) params = params.set('query', options.query);
    if (options.category) params = params.set('category', options.category);
    if (options.page) params = params.set('page', options.page.toString());
    if (options.pageSize) params = params.set('pageSize', options.pageSize.toString());
    return this.http.get<IconResult>(`${this.baseUrl}/icon/query`, { params });
  }

  getIcon(identifier: string): Observable<IconEntry> {
    return this.http.get<IconEntry>(`${this.baseUrl}/icon/${encodeURIComponent(identifier)}`);
  }
}
