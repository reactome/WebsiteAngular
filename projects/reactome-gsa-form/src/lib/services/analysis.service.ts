import { computed, Injectable, inject } from '@angular/core';
import { LoadingStatus } from '../model/load-dataset.model';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AnalysisResult } from '../model/analysis-result.model';
import { Request } from '../model/analysis.model';
import { catchError, EMPTY, Observable, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Method } from '../state/method/method.state';
import { Dataset } from '../state/dataset/dataset.state';
import { Parameter } from '../model/parameter.model';
import { extractErrorMessage } from '../utilities/utils';
import { ConfigProvider, REACTOME_GSA_CONFIG } from '../config/gsa-config';

/**
 * A parameter the reader never filled in has no value, and `value + ''` turns
 * that into the **string** `"undefined"`. For the email parameter that means
 * asking the analysis service to deliver a report to an address that cannot
 * exist, rather than telling it there is no address -- reports arrive, no mail
 * does, and nothing anywhere says why (#168).
 *
 * So unset parameters are left out. `false` and `0` are values and are kept;
 * only `undefined`, `null` and the empty string are absent.
 */
export function submittedParameters(parameters: Parameter[] | undefined) {
  return (parameters ?? [])
    .filter((param) => param.value !== undefined && param.value !== null && param.value !== '')
    .map((param) => ({ name: param.name, value: String(param.value) }));
}

@Injectable({
  providedIn: 'root',
})
export class AnalysisService {
  private http = inject(HttpClient);
  private snackBar = inject(MatSnackBar);
  private config = inject<ConfigProvider>(REACTOME_GSA_CONFIG);

  submitAnalysisUrl = computed(() => `${this.config().apiRoot}/analysis`);
  analysisStatusUrl = computed(() => `${this.config().apiRoot}/status/`);
  analysisResultUrl = computed(() => `${this.config().apiRoot}/result/`);
  reportStatusUrl = computed(() => `${this.config().apiRoot}/report_status/`);

  submitQuery(method: Method, parameters: Parameter[], datasets: Dataset[]): Observable<string> {
    const query: Request.Query = {
      methodName: method.name || 'Method name',
      parameters: submittedParameters(parameters),
      datasets: datasets.map((dataset: Dataset) => ({
        data: dataset.summary!.id,
        name: dataset.summary!.title,
        type: dataset.summary!.type,
        parameters: submittedParameters(
          dataset.summary!.parameters?.filter((para) => para.scope !== 'common')
        ),
        design: {
          analysisGroup: dataset.annotationColumns.get(dataset.statisticalDesign.analysisGroup!)!,
          samples: dataset.annotationColumns.get('sample_ids')!,
          comparison: {
            group1: dataset.statisticalDesign!.comparisonGroup1 as string,
            group2: dataset.statisticalDesign!.comparisonGroup2 as string,
          },
          ...dataset
            .statisticalDesign!.covariances.filter((cov) => cov.value)
            .reduce(
              (covs, cov) => ({
                ...covs,
                [cov.name]: dataset.annotationColumns.get(cov.name!)!,
              }),
              {}
            ),
        },
      })),
    };
    return this.http.post(this.submitAnalysisUrl(), query, { responseType: 'text' });
  }

  cancelAnalysis(analysisId: string): Observable<never> {
    return EMPTY; // TODO Switch to actual API call when backend ready (https://github.com/reactome/gsa-backend/issues/47)
  }

  getAnalysisLoadingStatus(analysisId: string): Observable<LoadingStatus> {
    return this.http.get<LoadingStatus>(this.analysisStatusUrl() + analysisId).pipe(
      catchError((err: HttpErrorResponse) => {
        this.snackBar.open(
          'The analysis could not be performed: \n' + extractErrorMessage(err),
          'Close',
          {
            panelClass: ['warning-snackbar'],
          }
        );
        return throwError(() => err); //Rethrow it back to component
      })
    );
  }

  getAnalysisResults(analysisId: string): Observable<AnalysisResult> {
    return this.http.get<AnalysisResult>(this.analysisResultUrl() + analysisId).pipe(
      catchError((err: HttpErrorResponse) => {
        this.snackBar.open(
          'The analysis could not been performed: \n' + extractErrorMessage(err),
          'Close',
          {
            panelClass: ['warning-snackbar'],
          }
        );
        return throwError(() => err); //Rethrow it back to component
      })
    );
  }

  getReportLoadingStatus(analysisId: string): Observable<LoadingStatus> {
    return this.http.get<LoadingStatus>(this.reportStatusUrl() + analysisId).pipe(
      catchError((err: HttpErrorResponse) => {
        this.snackBar.open(
          'The reports could not been loaded: \n' + extractErrorMessage(err),
          'Close',
          {
            panelClass: ['warning-snackbar'],
          }
        );
        return throwError(() => err); //Rethrow it back to component
      })
    );
  }
}
