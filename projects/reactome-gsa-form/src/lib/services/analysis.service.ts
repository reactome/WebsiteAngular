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

/**
 * A dataset's statistical design as the analysis is asked for it: the
 * annotation columns its design names, and the two groups compared. The form
 * asks for a complete design before it submits (selectStatisticalDesignComplete);
 * one that is not is said, rather than sent without its groups for the service
 * to refuse.
 */
export function submittedDesign(dataset: Dataset): Request.DataInformation | string {
  const design = dataset.statisticalDesign;
  const column = (name: string | undefined) =>
    name === undefined ? undefined : dataset.annotationColumns.get(name);
  const analysisGroup = column(design.analysisGroup);
  const samples = column('sample_ids');
  const { comparisonGroup1: group1, comparisonGroup2: group2 } = design;
  const incomplete = `The statistical design of "${dataset.summary.title}" is not complete`;
  // A name the design holds and the samples have no column for: the default
  // analysis group comes from the service, not from the annotation header, so
  // the form can show a design complete that names a column the samples lack.
  const noColumn = (name: string) =>
    `The statistical design of "${dataset.summary.title}" names "${name}", which its samples have no column for`;
  if (design.analysisGroup && !analysisGroup) return noColumn(design.analysisGroup);
  if (!analysisGroup || !samples || !group1 || !group2) return incomplete;
  const covariates: Record<string, string[]> = {};
  for (const covariate of design.covariances.filter((cov) => cov.value)) {
    const values = column(covariate.name);
    if (!values) return covariate.name ? noColumn(covariate.name) : incomplete;
    covariates[covariate.name] = values;
  }
  return { analysisGroup, samples, comparison: { group1, group2 }, ...covariates };
}

/**
 * A design the form will not send, as a refused request: a 400 with its reason
 * in `detail`, where extractErrorMessage reads the service's. Never a 503,
 * which the effect retries every minute as the service being busy.
 */
export function refusal(reason: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 400, error: { detail: reason } });
}

@Injectable({
  providedIn: 'root',
})
export class AnalysisService {
  private http = inject(HttpClient);
  private snackBar = inject(MatSnackBar);
  private config = inject<ConfigProvider>(REACTOME_GSA_CONFIG);

  readonly submitAnalysisUrl = computed(() => `${this.config().apiRoot}/analysis`);
  readonly analysisStatusUrl = computed(() => `${this.config().apiRoot}/status/`);
  readonly analysisResultUrl = computed(() => `${this.config().apiRoot}/result/`);
  readonly reportStatusUrl = computed(() => `${this.config().apiRoot}/report_status/`);

  submitQuery(method: Method, parameters: Parameter[], datasets: Dataset[]): Observable<string> {
    const submitted: Request.Dataset[] = [];
    for (const dataset of datasets) {
      const design = submittedDesign(dataset);
      // As a refused request is, its reason where the service puts one: the
      // effect answers it with loadFailure, which shows the reason.
      if (typeof design === 'string') return throwError(() => refusal(design));
      submitted.push({
        data: dataset.summary.id,
        name: dataset.summary.title,
        type: dataset.summary.type,
        parameters: submittedParameters(
          dataset.summary.parameters?.filter((para) => para.scope !== 'common')
        ),
        design,
      });
    }
    const query: Request.Query = {
      methodName: method.name || 'Method name',
      parameters: submittedParameters(parameters),
      datasets: submitted,
    };
    return this.http.post(this.submitAnalysisUrl(), query, { responseType: 'text' });
  }

  cancelAnalysis(_analysisId: string): Observable<never> {
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

  getReportLoadingStatus(analysisId: string): Observable<LoadingStatus> {
    return this.http.get<LoadingStatus>(this.reportStatusUrl() + analysisId).pipe(
      catchError((err: HttpErrorResponse) => {
        this.snackBar.open(
          'The reports could not be loaded: \n' + extractErrorMessage(err),
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
