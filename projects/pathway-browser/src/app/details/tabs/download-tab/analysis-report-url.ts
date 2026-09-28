/**
 * Where the Analysis Service serves the PDF report of a result.
 *
 * The report is of one species. The species filter holds taxonomy ids, and
 * can hold several; they were put into the path as they came, so with two
 * species chosen the link read `/report/<token>/9606,10090/report.pdf` and
 * the service answered 404. The first chosen species is the report's, and
 * with none chosen it is human, as it always was.
 */
export function analysisReportUrl(
  analysisService: string,
  token: string | undefined,
  speciesFilter: readonly string[]
): string {
  const species = speciesFilter[0] ?? 'Homo sapiens';
  return `${analysisService}/report/${token ?? ''}/${encodeURIComponent(species)}/report.pdf`;
}
