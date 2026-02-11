import {computed, inject, Injectable, signal} from '@angular/core';
import {Observable} from "rxjs";
import {HttpClient} from "@angular/common/http";
import {rxResource} from "@angular/core/rxjs-interop";
import {MatDialog} from "@angular/material/dialog";
import {CitationComponent} from "../../../pathway-browser/src/app/citation/citation.component";

export type DownloadUrl = {
  url: string;
  format: string
}

export enum ExportFormat {
  BIB = 'bib',
  RIS = 'ris',
  TXT = 'txt'
}

// Reactome Knowledgebase citation ID
const REACTOME_KNOWLEDGEBASE_ID = "37941124";
const REACTOME_HOST = "https://reactome.org";

@Injectable({
  providedIn: 'root'
})
export class CitationService {

  readonly dialog = inject(MatDialog);

  currentCitationId = signal<string>(REACTOME_KNOWLEDGEBASE_ID);
  currentCitationExportURLS = computed(() => this.getExportUrls(this.currentCitationId()))
  currentDate = new Date().toDateString();

  constructor(private http: HttpClient) {
  }

  citationData = rxResource({
    request: this.currentCitationId,
    loader: (params) => this.getCitation(params.request)
  })

  getCitation(id: string): Observable<string> {
    const staticUrl = `${REACTOME_HOST}/ContentService/citation/static/${id}`;
    return this.http.get(`${staticUrl}`, {responseType: 'text'});
  }

  openDialog() {
    this.currentCitationId.set(REACTOME_KNOWLEDGEBASE_ID);
    const dialogRef = this.dialog.open(CitationComponent, {
      data: {
        content: this.citationData.value,
        id: this.currentCitationId,
        downloadItems: this.currentCitationExportURLS
      },
      enterAnimationDuration: '450ms',
      exitAnimationDuration: '450ms',
    });
    dialogRef.afterClosed();
  }

  getExportUrls(id: string) {
    const urls: DownloadUrl[] = [];
    const isPathway = false; // Always false for website citations
    const formats = Object.values(ExportFormat)
    let url: DownloadUrl;
    for (const format of formats) {
      const link = `${REACTOME_HOST}/ContentService/citation/export?id=${id}&ext=${format}&isPathway=${isPathway}&dateAccessed=${this.currentDate}`;
      url = {url: link, format: format};
      urls.push(url);
    }
    return urls;
  }

  isStatic() {
    return true; // Always true for website citations
  }
}
