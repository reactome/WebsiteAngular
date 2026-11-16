import { HttpErrorResponse } from '@angular/common/http';

/**
 * The analysis service answers a bad submission with a Spring error body
 * ({timestamp, status, error, path}) rather than anything user-facing, so turn
 * what we get into a sentence worth showing. An empty dataset is the common
 * case and has a cause the user can act on.
 */
export function describeAnalysisFailure(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'Could not reach the analysis service. Check your connection and try again.';
    }
    if (error.status === 503) {
      return 'The analysis service is busy. Please try again in a minute.';
    }
    if (error.status === 400) {
      return 'The analysis service could not read the submitted data. Check that the table has at least one column of identifiers.';
    }
    const reason = (error.error as { reason?: string } | null)?.reason;
    // Not statusText: over HTTP/2 and later there is none, and Angular reports
    // "OK" whatever the status, which would read "failed (500 OK)".
    return reason ?? `The analysis failed (HTTP ${error.status}). Please try again.`;
  }
  return 'The analysis failed for an unknown reason. Please try again.';
}
