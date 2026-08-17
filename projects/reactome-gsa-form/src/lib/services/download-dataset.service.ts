import { Injectable, inject } from '@angular/core';
import {ConfigProvider, REACTOME_GSA_CONFIG} from "../config/gsa-config";


@Injectable({
  providedIn: 'root'
})
export class DownloadDatasetService {
  private config = inject<ConfigProvider>(REACTOME_GSA_CONFIG);


  url(datasetId: string, format: 'expr' | 'meta' = 'expr'): string {
    return `${this.config().apiRoot}/data/download/${datasetId}?format=${format}`
  }
}
