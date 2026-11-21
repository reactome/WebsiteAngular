import { Injectable, inject } from '@angular/core';
import { FileDownloadService } from './file-download.service';
import { ReportDownload, type ReportPort } from './report-download';

/**
 * The analysis reports asked for on this page, one per report address (spec 031): leaving
 * the Download tab and coming back finds the report where it was, still being made or
 * ready, rather than asking for another (FR-012).
 */
@Injectable({ providedIn: 'root' })
export class ReportDownloadsService {
  private readonly files = inject(FileDownloadService);
  private readonly reports = new Map<string, ReportDownload>();

  private readonly port: ReportPort = {
    fetch: (address, init) => fetch(address, init),
    save: (file, name) => this.files.save(file, name),
    now: () => Date.now(),
    // ends early, without an error, when the report is cancelled
    pause: (ms, signal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      }),
  };

  /** The report at `address`, the one already asked for if there is one. */
  report(address: string, fallbackName = 'report.pdf'): ReportDownload {
    let report = this.reports.get(address);
    if (!report) {
      report = new ReportDownload(address, fallbackName, this.port);
      this.reports.set(address, report);
    }
    return report;
  }
}
