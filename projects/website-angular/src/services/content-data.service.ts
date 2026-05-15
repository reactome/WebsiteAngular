import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

@Injectable({
  providedIn: 'root',
})
export class ContentDataService {
  private http = inject(HttpClient);
  private baseUrl = `${CONTENT_SERVICE}/data`;
  private schemaUrl = `${CONTENT_SERVICE}/data/schema`;

  getTocPathways(): Observable<TocPathway[]> {
    return this.http.get<TocPathway[]>(`${this.baseUrl}/toc`);
  }

  getDoiPathways(): Observable<DoiPathway[]> {
    return this.http.get<DoiPathway[]>(`${this.baseUrl}/doi`);
  }

  getContributors(): Observable<Contributor[]> {
    return this.http.get<Contributor[]>(`${this.baseUrl}/contributors`);
  }

  getSchemaModel(): Observable<SchemaNode> {
    return this.http.get<SchemaNode>(`${this.schemaUrl}/model`);
  }

  getSchemaAttributes(className: string): Observable<SchemaAttribute[]> {
    return this.http.get<SchemaAttribute[]>(
      `${this.schemaUrl}/${className}/attributes`
    );
  }

  getSchemaReferrals(className: string): Observable<SchemaAttribute[]> {
    return this.http.get<SchemaAttribute[]>(
      `${this.schemaUrl}/${className}/referrals`
    );
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
    return this.http.get<any>(
      `${this.baseUrl}/query/enhanced/${id}`
    );
  }
}
