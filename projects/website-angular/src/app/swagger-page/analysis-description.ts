/**
 * The analysis service's own description, with what this site adds to its
 * report (spec 031, User Story 4, T026). The description is Java's, written
 * before a report needed a person's check; the page says so where the report
 * is described, and leaves every other operation as the service gives it.
 */

/** The report's operation, as the analysis service's description names its path. */
export const REPORT_PATH = '/report/{token}/{species}/{filename}.pdf';

/** What the report's operation says now, after the service's own words. */
export const REPORT_CHECK =
  "A report is made only for a person who has passed the site's human check, on the " +
  "analysis's Download tab of the Pathway Browser. Without it, a browser opening this " +
  'address is sent to that tab, and any other caller is refused with a 401 that names the ' +
  'results to take instead. For automated use, take the results themselves: ' +
  '/token/{token}, and the files under /download/{token}/ (result.json.gz and the CSV files).';

const REFUSED = "Not made: no human check passed (the answer names the results' addresses)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The description with the report's operation amended: its text followed by
 * REPORT_CHECK, and the 401 among its answers. A description without that
 * operation is returned as it was.
 */
export function withReportCheck(description: unknown): unknown {
  if (!isRecord(description) || !isRecord(description['paths'])) return description;
  const path = description['paths'][REPORT_PATH];
  if (!isRecord(path) || !isRecord(path['get'])) return description;
  const operation = path['get'];
  const said = typeof operation['description'] === 'string' ? operation['description'] : '';
  const responses = isRecord(operation['responses']) ? operation['responses'] : {};
  return {
    ...description,
    paths: {
      ...description['paths'],
      [REPORT_PATH]: {
        ...path,
        get: {
          ...operation,
          description: said === '' ? REPORT_CHECK : `${said}\n\n${REPORT_CHECK}`,
          responses: { ...responses, '401': { description: REFUSED } },
        },
      },
    },
  };
}
