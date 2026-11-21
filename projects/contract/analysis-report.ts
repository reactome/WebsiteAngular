/**
 * The analysis report's answer while it is made: pdf-export's 202, through the analysis
 * gateway (pdf-export spec 002, contracts/service.md, T029; this repository's spec 031).
 * Types only (spec 016).
 */

/** Where a report is: each field absent where it does not apply, never null or 0. */
export type AnalysisReportStatus = {
  state: 'queued' | 'making';
  /** Its place in the queue, 1 being the next to start; while queued. */
  place?: number;
  /** While being made: reading the results, drawing the figures, printing. */
  stage?: 'reading' | 'figures' | 'printing';
  /** Figures drawn so far, and to draw; while drawing them. */
  done?: number;
  total?: number;
  /** Whole seconds left, where past reports give an estimate. */
  estimate?: number;
};

/** The 202's body, as pdf-export writes it for a caller that does not ask for a page. */
export type AnalysisReportAccepted = {
  code: 202;
  reason: string;
  messages: string[];
  /** Absent from a pdf-export before spec 002 T029. */
  status?: AnalysisReportStatus;
};
