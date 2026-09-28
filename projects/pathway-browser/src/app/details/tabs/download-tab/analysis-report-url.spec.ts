import { describe, expect, it } from 'vitest';
import { analysisReportUrl } from './analysis-report-url';

describe('the PDF report of an analysis', () => {
  const AS = '/AnalysisService';

  it('is of human when no species is chosen', () => {
    expect(analysisReportUrl(AS, 'T', [])).toBe(
      '/AnalysisService/report/T/Homo%20sapiens/report.pdf'
    );
  });

  it('is of the species chosen', () => {
    expect(analysisReportUrl(AS, 'T', ['10090'])).toBe(
      '/AnalysisService/report/T/10090/report.pdf'
    );
  });

  // The service answers 404 for "9606,10090": a report is of one species.
  it('is of the first species when several are chosen, not of a list', () => {
    expect(analysisReportUrl(AS, 'T', ['9606', '10090'])).toBe(
      '/AnalysisService/report/T/9606/report.pdf'
    );
  });
});
