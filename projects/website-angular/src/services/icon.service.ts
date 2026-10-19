import { computed, Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CONTENT_SERVICE } from '../../../pathway-browser/src/environments/environment';
import { GeneralService } from '../../../pathway-browser/src/app/services/general.service';
import { iconArtworkBase } from '../../../pathway-browser/src/app/services/icon.service';
import { IconFacetResponse, IconEntry, IconResult } from '../model/icon.model';

@Injectable({
  providedIn: 'root',
})
export class IconService {
  private general = inject(GeneralService);

  private readonly iconBase = computed(() => iconArtworkBase(this.general.current()));

  /** The URL of an icon's SVG, wherever icons are being served from. */
  iconUrl(stId: string) {
    return `${this.iconBase()}/${stId}.svg`;
  }

  private http = inject(HttpClient);
  private baseUrl = `${CONTENT_SERVICE}/search`;

  getFacets(): Observable<IconFacetResponse> {
    return this.http.get<IconFacetResponse>(`${this.baseUrl}/icon/facet`);
  }

  queryIcons(
    // Each is left off the request when it is missing or empty.
    options: {
      query?: string | undefined;
      category?: string | undefined;
      page?: number;
      pageSize?: number;
    } = {}
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
