import { Component, computed, inject, input } from '@angular/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import type { AnalysisReportStatus } from '../../../../../../../contract/analysis-report.ts';
import type { ReportPhase } from '../../../../services/report-download';
import { ReportDownloadsService } from '../../../../services/report-downloads.service';

/**
 * Seconds left as the line says them: in tens of seconds under two minutes, so the line
 * moves while a slow figure is drawn (on beta, "about 1 minute" stood for 15 s at a time),
 * then in minutes.
 */
export function timeLeft(seconds: number | undefined): string | null {
  if (seconds === undefined) return null;
  if (seconds === 0) return 'taking longer than expected';
  if (seconds < 10) return 'a few seconds left';
  if (seconds < 120) return `about ${String(Math.round(seconds / 10) * 10)} seconds left`;
  const minutes = Math.round(seconds / 60);
  return `about ${String(minutes)} minute${minutes === 1 ? '' : 's'} left`;
}

/** Where a report is, as the line says it (contracts/report-states.md). */
export function waitingWords(report: AnalysisReportStatus): string {
  let where: string;
  if (report.state === 'queued') {
    where =
      report.place === undefined
        ? 'Queued'
        : report.place === 1
          ? 'Queued: next in line'
          : `Queued: number ${String(report.place)} in line`;
  } else if (
    report.stage === 'figures' &&
    report.done !== undefined &&
    report.total !== undefined
  ) {
    where = `Making your report: drawing figures ${String(report.done)} of ${String(report.total)}`;
  } else if (report.stage === 'printing') {
    where = 'Making your report: printing';
  } else if (report.stage === 'reading') {
    where = 'Making your report: reading the results';
  } else {
    where = 'Making your report';
  }
  const left = timeLeft(report.estimate);
  return left === null ? where : `${where} · ${left}`;
}

/** What the line says for a phase; null for none. */
export function phaseWords(phase: ReportPhase): string | null {
  switch (phase.status) {
    case 'idle':
      return null;
    case 'starting':
      return 'Starting your report…';
    case 'waiting':
      return waitingWords(phase.report);
    case 'saved':
      return 'Report downloaded';
    case 'failed':
      switch (phase.failure) {
        case 'gone':
          return "This analysis's results are no longer available. Run the analysis again to make a report.";
        case 'busy':
          return phase.retryAfter === undefined
            ? 'The report service is busy. Try again shortly.'
            : `The report service is busy. Try again in ${String(phase.retryAfter)} seconds.`;
        case 'failed':
          return 'The report could not be made. Try again, or tell us through the contact form.';
        case 'unreachable':
          return 'No word from the report service for two minutes.';
      }
  }
}

/**
 * The analysis report's button, made and followed on the page (spec 031): the report used
 * to open in a tab of its own, which asked again every 10 s and said nothing until the file
 * arrived there. It stays a link to the report's address, so a modified click (a new tab,
 * "Save link as") gets the service's own page as before.
 */
@Component({
  selector: 'cr-report-download',
  imports: [MatAnchor, MatButton, MatIcon, MatProgressSpinner, MatTooltip],
  templateUrl: './report-download.component.html',
  styleUrls: [
    '../download-button/download-button.component.scss',
    './report-download.component.scss',
  ],
})
export class ReportDownloadComponent {
  private readonly reports = inject(ReportDownloadsService);

  readonly address = input.required<string>();
  readonly label = input<string>('PDF Result');
  readonly tooltip = input<string>();

  readonly report = computed(() => this.reports.report(this.address()));
  readonly phase = computed(() => this.report().phase());
  readonly words = computed(() => phaseWords(this.phase()));
  readonly busy = computed(() => this.report().busy());
  readonly failure = computed(() => {
    const phase = this.phase();
    return phase.status === 'failed' ? phase.failure : null;
  });

  onClick(event: MouseEvent): void {
    // a modified click is the reader asking the browser for the address itself
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const report = this.report();
    if (this.phase().status === 'saved') report.again();
    else report.ask();
  }

  cancel(): void {
    this.report().cancel();
  }

  retry(): void {
    this.report().ask();
  }
}
