import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { retry, timeout } from 'rxjs/operators';
import { CONTENT_SERVICE } from '../../../../projects/pathway-browser/src/environments/environment';

export interface SimplePerson {
  dbId: number;
  displayName: string;
  surname: string;
  firstname: string;
  orcidId: string | null;
}

export interface TocSubpathway {
  stId: string;
  displayName: string;
  doi: string | null;
  speciesName: string;
}

export interface TocPathway {
  stId: string;
  displayName: string;
  doi: string | null;
  species: string;
  releaseDate: string;
  reviseDate: string;
  releaseStatus: string | null;
  authors: SimplePerson[];
  reviewers: SimplePerson[];
  editors: SimplePerson[];
  subpathways: TocSubpathway[];
}

export interface DoiPathway {
  stId: string;
  displayName: string;
  doi: string | null;
  species: string;
  releaseDate: string;
  reviseDate: string;
  releaseStatus: string | null;
  authors: SimplePerson[];
  reviewers: SimplePerson[];
  editors: SimplePerson[];
}

export interface Contributor {
  person: SimplePerson;
  authoredPathways: number;
  reviewedPathways: number;
  authoredReactions: number;
  reviewedReactions: number;
}

export interface SchemaNode {
  className: string;
  count: number;
  children: SchemaNode[];
}

export interface SchemaValueType {
  name: string;
  databaseObject: boolean;
}

export interface SchemaAttribute {
  name: string;
  cardinality: string;
  valueTypes: SchemaValueType[];
  origin: string;
}

export interface SimpleDatabaseObject {
  dbId: number;
  stId: string;
  displayName: string;
  schemaClass: string;
}

export interface InstanceReferrals {
  referral: string;
  objects: SimpleDatabaseObject[];
}

@Injectable({
  providedIn: 'root',
})
export class ContentDataService {
  private http = inject(HttpClient);
  private baseUrl = `${CONTENT_SERVICE}/data`;
  private schemaUrl = `${CONTENT_SERVICE}/data/schema`;

  // The schema must come from the same content-service as the rest of the page,
  // so it stays in sync with that deployment's database -- notably for curator,
  // where the curation database's model legitimately differs from the public
  // one. Serving a different host's schema would quietly show the wrong model,
  // which is worse than failing to load. So bound the request and retry once,
  // but never fall back to another host.
  private fetchModel<T>(path: string): Observable<T> {
    return this.http
      .get<T>(`${this.schemaUrl}/${path}`)
      .pipe(timeout(8000), retry({ count: 1, delay: () => timer(500) }));
  }

  // ContentPageController is mapped at /data with paths /content/toc,
  // /content/doi and /content/contributors. These were missing the /content
  // segment, so all three requests 404'd and the pages rendered empty -- which
  // is what curators saw as "on ToC, beta lists 0 new".
  getTocPathways(): Observable<TocPathway[]> {
    return this.http.get<TocPathway[]>(`${this.baseUrl}/content/toc`);
  }

  getDoiPathways(): Observable<DoiPathway[]> {
    return this.http.get<DoiPathway[]>(`${this.baseUrl}/content/doi`);
  }

  getContributors(): Observable<Contributor[]> {
    return this.http.get<Contributor[]>(`${this.baseUrl}/content/contributors`);
  }

  getSchemaModel(): Observable<SchemaNode> {
    return this.fetchModel<SchemaNode>('model');
  }

  getSchemaAttributes(className: string): Observable<SchemaAttribute[]> {
    return this.http.get<SchemaAttribute[]>(`${this.schemaUrl}/${className}/attributes`);
  }

  getSchemaReferrals(className: string): Observable<SchemaAttribute[]> {
    return this.http.get<SchemaAttribute[]>(`${this.schemaUrl}/${className}/referrals`);
  }

  getSchemaEntries(
    className: string,
    page: number,
    offset: number,
    species?: string
  ): Observable<SimpleDatabaseObject[]> {
    let url = `${this.schemaUrl}/${className}/min?page=${page}&offset=${offset}`;
    if (species) url += `&species=${encodeURIComponent(species)}`;
    return this.http.get<SimpleDatabaseObject[]>(url);
  }

  getSchemaCount(className: string, species?: string): Observable<number> {
    let url = `${this.schemaUrl}/${className}/count`;
    if (species) url += `?species=${encodeURIComponent(species)}`;
    return this.http.get<number>(url);
  }

  getInstance(id: string | number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/query/enhanced/${id}`);
  }

  getInstanceReferrers(id: string | number): Observable<InstanceReferrals[]> {
    return this.http.get<InstanceReferrals[]>(`${this.baseUrl}/instance/${id}/referrers`);
  }
}
