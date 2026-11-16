import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './utils';

const failure = (status: number, error: unknown) =>
  new HttpErrorResponse({ status, statusText: 'Failed', url: 'https://gsa.test/x', error });

// The message every failure of the form's requests is shown with. It is read
// inside the requests' catchError, so one that throws replaces the failure with
// its own TypeError, and the reader is told nothing.
describe('the message a ReactomeGSA failure is shown with', () => {
  it("is the service's own reason, as an object or as JSON text", () => {
    expect(extractErrorMessage(failure(400, { detail: 'No such dataset' }))).toBe(
      'No such dataset'
    );
    expect(extractErrorMessage(failure(400, '{"detail": "No such dataset"}'))).toBe(
      'No such dataset'
    );
  });

  it('says a 502 may be a dataset too large', () => {
    expect(extractErrorMessage(failure(502, null))).toMatch(/too large/);
  });

  it('is the failure itself when the service gave no reason', () => {
    const plain = failure(500, 'Internal Server Error');
    expect(extractErrorMessage(plain)).toBe(plain.message);
    const empty = failure(404, null);
    expect(extractErrorMessage(empty)).toBe(empty.message);
    // A request that never reached the service: the body is the browser's event.
    const offline = failure(0, new ProgressEvent('error'));
    expect(extractErrorMessage(offline)).toBe(offline.message);
    const broken = failure(500, '{not json');
    expect(extractErrorMessage(broken)).toBe(broken.message);
  });
});
