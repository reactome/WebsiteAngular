import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { describeAnalysisFailure } from './analysis-failure';

// What each analysis form tells the reader when an analysis fails. A busy
// service (spec 010 Story 6) is asked once more first; if it is still busy,
// the reader is told so plainly, not shown "Service Unavailable".
describe('describeAnalysisFailure', () => {
  it('says the service is busy, and when to come back', () => {
    expect(describeAnalysisFailure(new HttpErrorResponse({ status: 503 }))).toMatch(
      /busy.*try again/i
    );
  });

  it('keeps its other answers', () => {
    expect(describeAnalysisFailure(new HttpErrorResponse({ status: 0 }))).toMatch(
      /could not reach/i
    );
    expect(describeAnalysisFailure(new HttpErrorResponse({ status: 400 }))).toMatch(
      /could not read/i
    );
    expect(describeAnalysisFailure(new Error('x'))).toMatch(/unknown reason/i);
  });
});
