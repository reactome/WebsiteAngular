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

  // A species comparison or an unprojected list is of its own species; the
  // report was of human regardless.
  it("is of the result's own species when none is chosen", () => {
    expect(analysisReportUrl(AS, 'T', [], 48892)).toBe(
      '/AnalysisService/report/T/48892/report.pdf'
    );
  });

  it("is of the chosen species over the result's", () => {
    expect(analysisReportUrl(AS, 'T', ['9606'], 48892)).toBe(
      '/AnalysisService/report/T/9606/report.pdf'
    );
  });
});
