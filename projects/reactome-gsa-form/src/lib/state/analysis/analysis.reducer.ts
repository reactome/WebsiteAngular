import { ActionReducer, createReducer, on } from '@ngrx/store';
import { AnalysisState, initialState } from './analysis.state';
import { analysisActions } from './analysis.actions';
import { HttpErrorResponse } from '@angular/common/http';
import { extractErrorMessage } from '../../utilities/utils';
import { PLoadingStatus } from '../../model/load-dataset.model';

/**
 * What a failed submission is shown as. It fails as an HTTP response, the
 * service's or the form's own refusal; anything else is the form's error.
 */
function failureMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) return extractErrorMessage(error);
  return error instanceof Error ? error.message : String(error);
}

export const analysisReducer: ActionReducer<AnalysisState> = createReducer(
  initialState,
  on(analysisActions.load, (state, { reportsRequired }) => ({
    ...state,
    reportsRequired,
    analysisLoadingStatus: {
      status: 'pending',
      id: 'unknown',
      description: 'Sending request to servers',
      completed: 0,
    } as PLoadingStatus,
  })),
  on(analysisActions.loadOverloaded, (state) => ({
    ...state,
    analysisLoadingStatus: {
      status: 'pending',
      id: 'unknown',
      description: 'Servers are up-scaling, retrying analysis in a minute ',
      completed: 0,
    } as PLoadingStatus,
  })),
  on(analysisActions.loadSuccess, (state, { analysisId }) => ({ ...state, analysisId })),
  on(analysisActions.loadFailure, (state, { error }) => ({
    ...state,
    analysisLoadingStatus: {
      status: 'failed',
      id: 'unknown',
      description: failureMessage(error),
    } as PLoadingStatus,
  })),
  on(analysisActions.setLoadingStatus, (state, { status }) => ({
    ...state,
    analysisLoadingStatus: status,
  })),
  on(analysisActions.setReportLoadingStatus, (state, { status }) => ({
    ...state,
    reportLoadingStatus: status,
  })),
  on(analysisActions.setAnalysisResults, (state, { result }) => ({
    ...state,
    analysisResult: result,
  })),
  on(analysisActions.cancel, () => ({ ...initialState }))
);
