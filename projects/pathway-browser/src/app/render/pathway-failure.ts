import { HttpErrorResponse } from '@angular/common/http';
import type { RenderFailure } from '../../../../contract/render.ts';
import { failureMessage } from './failure-message';

/**
 * What the page reports for a pathway whose read has settled with nothing to
 * draw: "no pathway found" only where the content service said the pathway is
 * not there (a 404 or 410, or an empty answer). Any other failure is a read
 * that failed, and said as one. Every failed read was "no pathway found" once:
 * six pathways that exist were reported missing while the content service was
 * slow (spec 018 T010, T017), a failure nobody retries.
 *
 * `error` is the read's error: undefined where it answered, with nothing.
 */
export function pathwayFailure(
  pathway: string,
  error: unknown
): { error: string; failure: RenderFailure } {
  if (error === undefined || isAbsent(error))
    return { error: `no pathway found for ${pathway}`, failure: 'not-found' };
  // A failed request is not an Error: its message would read "[object Object]".
  const message =
    error instanceof HttpErrorResponse || error instanceof Error ? error.message : String(error);
  return {
    error: `could not read pathway ${pathway}: ${failureMessage(message)}`,
    failure: 'unreadable',
  };
}

/** The content service's answer that there is no such object. */
function isAbsent(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410);
}
