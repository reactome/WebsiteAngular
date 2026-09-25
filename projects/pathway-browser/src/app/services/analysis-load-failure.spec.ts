import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { describeLoadFailure } from './analysis.service';

// A result that could not be loaded used to be dropped without a word: the
// token was removed from the address and the reader was left looking at a
// pathway with no results and no reason. Quantitative analyses sent to
// ReactomeGSA landed there on beta, which reads a different Analysis Service
// from the one GSA writes to -- the reader saw nothing happen at all.
const status = (code: number) =>
  new HttpErrorResponse({ status: code, url: '/AnalysisService/token/x' });

describe('what the reader is told when a result cannot be loaded', () => {
  it('says a result that is gone is not available here, and what to do', () => {
    for (const code of [404, 410]) {
      const message = describeLoadFailure(status(code));
      expect(message).toMatch(/not available/i);
      expect(message).toMatch(/run the analysis again/i);
    }
  });

  it('says anything else is a failure to load, worth retrying', () => {
    for (const error of [status(500), status(0), new Error('boom')]) {
      expect(describeLoadFailure(error)).toMatch(/could not be loaded/i);
    }
  });
});
