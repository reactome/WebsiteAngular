import { describe, expect, it } from 'vitest';
import { REPORT_CHECK, REPORT_PATH, withReportCheck } from './analysis-description';

// The report's operation as the analysis service describes it (its own words, trimmed).
const description = {
  openapi: '3.0.1',
  servers: [{ url: '/AnalysisService' }],
  paths: {
    [REPORT_PATH]: {
      get: {
        operationId: 'generatePdfReport',
        description: 'This method provides a report for a given pathway analysis result.',
        responses: { '404': { description: 'Not found' }, '410': { description: 'Gone' } },
      },
    },
    '/token/{token}': { get: { operationId: 'getToken', description: 'The result.' } },
  },
};

describe("the analysis service's description, on the API page", () => {
  it("adds the human check to the report's operation, after the service's own words", () => {
    const amended = withReportCheck(description) as typeof description;
    const report = amended.paths[REPORT_PATH].get;
    expect(report.description).toBe(
      `This method provides a report for a given pathway analysis result.\n\n${REPORT_CHECK}`
    );
    expect(Object.keys(report.responses).sort()).toEqual(['401', '404', '410']);
    expect(REPORT_CHECK).toContain('/download/{token}/');
  });

  it('leaves every other operation, and the description given, as they were', () => {
    const before = JSON.stringify(description);
    const amended = withReportCheck(description) as typeof description;
    expect(JSON.stringify(description)).toBe(before);
    expect(amended.paths['/token/{token}']).toEqual(description.paths['/token/{token}']);
    expect(amended.servers).toEqual(description.servers);
  });

  it('returns a description without the report as it was', () => {
    const other = { paths: { '/token/{token}': {} } };
    expect(withReportCheck(other)).toBe(other);
    expect(withReportCheck(null)).toBeNull();
    expect(withReportCheck('not a description')).toBe('not a description');
  });
});
