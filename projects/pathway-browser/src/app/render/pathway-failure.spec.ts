import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { pathwayFailure } from './pathway-failure';

/** A failed read of the pathway, as HttpClient reports it. */
const answered = (status: number, statusText: string) =>
  new HttpErrorResponse({
    status,
    statusText,
    url: 'http://internal-host:4200/ContentService/data/query/enhanced/v2/R-HSA-5357769',
  });

describe('pathwayFailure, what the render page says of a pathway with nothing to draw', () => {
  it('says "no pathway found" when the content service answers that it is not there', () => {
    expect(pathwayFailure('R-HSA-0', answered(404, 'Not Found'))).toEqual({
      error: 'no pathway found for R-HSA-0',
      failure: 'not-found',
    });
    expect(pathwayFailure('R-HSA-0', answered(410, 'Gone')).failure).toBe('not-found');
  });

  it('says "no pathway found" for an answer with nothing in it', () => {
    expect(pathwayFailure('R-HSA-0', undefined)).toEqual({
      error: 'no pathway found for R-HSA-0',
      failure: 'not-found',
    });
  });

  // Six pathways that exist were reported missing in T010 while the content
  // service was slow.
  it('says the read failed, not that the pathway is missing, for a slow or failing service', () => {
    expect(pathwayFailure('R-HSA-5357769', answered(504, 'Gateway Timeout'))).toEqual({
      error:
        'could not read pathway R-HSA-5357769: Http failure response for ' +
        '/ContentService/data/query/enhanced/v2/R-HSA-5357769: 504 Gateway Timeout',
      failure: 'unreadable',
    });
    expect(pathwayFailure('R-HSA-140534', answered(500, 'Internal Server Error')).failure).toBe(
      'unreadable'
    );
    expect(pathwayFailure('R-HSA-169911', answered(503, 'Service Unavailable')).failure).toBe(
      'unreadable'
    );
  });

  it('says the read failed when no answer came at all', () => {
    // A connection refused or cut: HttpClient's status 0.
    const failed = pathwayFailure('R-HSA-169911', answered(0, 'Unknown Error'));
    expect(failed.failure).toBe('unreadable');
    expect(failed.error).toMatch(/^could not read pathway R-HSA-169911: /);
    expect(failed.error, 'the address the page reaches the site on').not.toContain('internal-host');
  });

  it('says the read failed for an error that is not an HTTP answer', () => {
    expect(pathwayFailure('R-HSA-1', new TypeError('flattenReferences: bad JSOG'))).toEqual({
      error: 'could not read pathway R-HSA-1: flattenReferences: bad JSOG',
      failure: 'unreadable',
    });
  });
});
