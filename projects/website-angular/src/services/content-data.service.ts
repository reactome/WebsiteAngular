import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

@Injectable({
  providedIn: 'root',
})
export class ContentDataService {
  private http = inject(HttpClient);
  private baseUrl = 'https://dev.reactome.org/ContentService/data/content';

  getTocPathways(): Observable<TocPathway[]> {
    return this.http.get<TocPathway[]>(`${this.baseUrl}/toc`);
  }

  getDoiPathways(): Observable<DoiPathway[]> {
    return this.http.get<DoiPathway[]>(`${this.baseUrl}/doi`);
  }

  getContributors(): Observable<Contributor[]> {
    return this.http.get<Contributor[]>(`${this.baseUrl}/contributors`);
  }
}
