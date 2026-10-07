import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { CONTENT_SERVICE } from '../../../../projects/pathway-browser/src/environments/environment';

/**
 * One search hit, as `/search/query` actually returns it.
 *
 * Solr omits a field rather than sending it empty, so most of this is optional
 * -- and it was all declared required, which is worse than it sounds. A field
 * the type promises is always there can be dereferenced anywhere without
 * complaint, so `strictTemplates` agrees right up until the page renders
 * `undefined`. The templates already knew better and guarded with `?.`, which
 * is why the build emitted seventeen NG8107/NG8102 diagnostics telling us to
 * remove guards that are load-bearing. The type was the thing that was wrong.
 *
 * Measured against the running service, 444 entries over three queries
 * (`TP53`, `insulin`, `membrane`), so it can be re-measured rather than
 * believed:
 *
 *     always present   dbId, stId, id, name, type, exactType
 *     referenceName    absent in 81%
 *     databaseName     absent in 73%   referenceIdentifier  73%
 *     referenceURL     absent in 73%   summation            58%
 *     compartmentNames absent in 21%   isDisease            11%
 *     species          absent in 0.5%  -- rare, not never
 *     deleted, date    absent in 100%  -- they arrive only on deleted entries
 *
 * The service also returns `compartmentAccession`, `hasReferenceEntity`,
 * `disease`, `hasEHLD` and `explanation`, which nothing here reads. They are
 * left undeclared deliberately: adding a field nobody uses invites somebody to
 * use it without checking whether it is always sent.
 */
export interface SearchEntry {
  dbId: number;
  stId: string;
  id: string;
  name: string;
  type: string;
  exactType: string;
  species?: string[];
  summation?: string;
  compartmentNames?: string[];
  isDisease?: boolean;
  referenceName?: string;
  referenceIdentifier?: string;
  databaseName?: string;
  referenceURL?: string;
  deleted?: boolean;
  date?: number;

  // Present only on deleted entries: where the object went, so the result can
  // link on to its replacement.
  replacementStIds?: string[];

  // Icon results carry their own attribution block. The search service only
  // sends these for type Icon, hence optional.
  icon?: string;
  iconName?: string;
  iconCuratorName?: string;
  iconCuratorOrcidId?: string;
  iconDesignerName?: string;
  iconDesignerUrl?: string;
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

  getFacets(query: string, filters: SearchFilters = {}): Observable<FacetResponse> {
    const params = this.buildParams(query, filters);
    return this.http.get<FacetResponse>(`${this.baseUrl}/facet_query`, {
      params,
    });
  }

  getAllFacets(): Observable<FacetResponse> {
    return this.http.get<FacetResponse>(`${this.baseUrl}/facet`);
  }

  getSuggestedTerms(query: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/suggest?query=${encodeURIComponent(query)}`);
  }

  getSpellCheckTerms(query: string): Observable<string[]> {
    return this.http
      .get<string[]>(`${this.baseUrl}/spellcheck?query=${encodeURIComponent(query)}`)
      .pipe(map((terms) => usableSpellCheckTerms(query, terms)));
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

/**
 * Drops the tokeniser artefacts Solr offers as spelling corrections.
 *
 * `spellcheck` answers a single mistyped word with the word *and* with the word
 * chopped up, offered as equals. Measured against beta:
 *
 *     apoptsis -> ["apoptosis", "ap opt sis", "apo pt sis"]
 *
 * The pieces are not words, and the reason nobody noticed is that clicking one
 * does not fail. The terms are split and OR'd, so it returns a *bigger* result
 * set than the correct spelling and looks like it worked:
 *
 *     "apoptosis"   1058 matches      <- the right answer
 *     "ap opt sis"  2793 matches      <- nonsense, and more of it
 *
 * The rule is token count rather than "contains a space": a genuine multi-word
 * correction for a multi-word query is legitimate and must survive. Only a
 * suggestion split into a different number of pieces than was asked for is an
 * artefact.
 *
 * This does **not** address the other complaint about this endpoint -- `Tello`
 * suggests `ttll3`, `ttll8`, `ttlls` -- because those are single tokens and
 * legitimate by edit distance. Nothing here can tell that a person's surname
 * should not be corrected to a gene symbol; that needs vocabulary rather than
 * string distance.
 */
export function usableSpellCheckTerms(query: string, terms: string[] | null): string[] {
  const asked = (query ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (!terms || asked === 0) return terms ?? [];
  return terms.filter((term) => term.trim().split(/\s+/).filter(Boolean).length === asked);
}
