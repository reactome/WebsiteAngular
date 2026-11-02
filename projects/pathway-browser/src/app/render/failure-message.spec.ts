import { describe, expect, it } from 'vitest';
import { failureMessage } from './failure-message';

describe('failureMessage', () => {
  it('drops the host and keeps the path', () => {
    expect(
      failureMessage(
        'Http failure response for http://localhost:4200/ContentService/data/query/R-HSA-1: 404 Not Found'
      )
    ).toBe('Http failure response for /ContentService/data/query/R-HSA-1: 404 Not Found');
  });

  it('drops the host whatever its case', () => {
    expect(failureMessage('for HTTP://LOCALHOST:4200/ContentService/x: 500')).toBe(
      'for /ContentService/x: 500'
    );
  });

  it('hides a token in the path', () => {
    expect(
      failureMessage(
        'Http failure response for https://h/AnalysisService/token/MjAyNjExMDIx/found/all/R-HSA-1?resource=TOTAL: 500 Internal Server Error'
      )
    ).toBe(
      'Http failure response for /AnalysisService/token/…/found/all/R-HSA-1?resource=TOTAL: 500 Internal Server Error'
    );
  });

  it('hides a token at the end of the path', () => {
    expect(failureMessage('for /AnalysisService/token/MjAyNjExMDIx: 410 Gone')).toBe(
      'for /AnalysisService/token/…: 410 Gone'
    );
  });

  it('hides a token in the query, as token= or analysis=, wherever it stands', () => {
    expect(failureMessage('for /tree?species=9606&token=MjAy&resource=TOTAL: 500')).toBe(
      'for /tree?species=9606&token=…&resource=TOTAL: 500'
    );
    expect(failureMessage('for /render/R-HSA-1?ANALYSIS=MjAy: 500')).toBe(
      'for /render/R-HSA-1?ANALYSIS=…: 500'
    );
  });

  it('leaves a message with neither as it was', () => {
    expect(failureMessage('no pathway found for R-HSA-1')).toBe('no pathway found for R-HSA-1');
  });
});
