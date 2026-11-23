import { computed, signal } from '@angular/core';
import type { AnalysisReportStatus } from '../../../../contract/analysis-report.ts';
import { filenameFrom } from './file-download.service';

/**
 * One analysis report, asked for and followed on the page (spec 031). The report's button
 * opened its address in a tab of its own, which asked again every 10 s and said nothing
 * while the report was made; the file then arrived in that tab.
 *
 * The report's address is asked for JSON as well as the PDF: while the report is made it
 * answers 202 with where it is (pdf-export spec 002, T029), held at most `HOLD_S` by
 * `Prefer: wait`, and is asked again at once; when it is ready, 200 with the PDF, which is
 * saved and kept to save again.
 *
 * A report is made only for a person (spec 031, User Story 4): without the site's human
 * pass the address answers 401 with the check to make (`sitekey`, `verify`), as the analysis
 * summary's route does; the line shows it, and once it passes the report is asked for again.
 */

/** How long one request may be held while the report is made, in seconds (FR-006: 10). */
const HOLD_S = 5;
/** No answer at all for this long and the status is said to be unknown (spec, edge cases). */
export const SILENCE_MS = 120_000;
/** How long the file is kept to save again: as long as pdf-export keeps the report. */
export const KEEP_MS = 3_600_000;
/** The pause before asking again after a request that got no answer. */
const AGAIN_MS = 5_000;

type ReportFailure = 'gone' | 'busy' | 'failed' | 'unreachable' | 'not_checked' | 'no_check';

/** The human check the address asks for before a report is made. */
export interface ReportChallenge {
  sitekey: string;
  verify: string;
}

export type ReportPhase =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'checking'; challenge: ReportChallenge }
  | { status: 'waiting'; report: AnalysisReportStatus }
  | { status: 'saved' }
  | { status: 'failed'; failure: ReportFailure; retryAfter?: number };

/** What a report needs of the page: its requests, the saving of a file, and the time. */
export interface ReportPort {
  fetch: (address: string, init: RequestInit) => Promise<Response>;
  save: (file: Blob, name: string) => void;
  now: () => number;
  pause: (ms: number, signal: AbortSignal) => Promise<void>;
}

export class ReportDownload {
  private readonly current = signal<ReportPhase>({ status: 'idle' });
  readonly phase = this.current.asReadonly();
  /** When the report was asked for, for "taking longer than expected". */
  readonly askedAt = signal<number | null>(null);
  readonly busy = computed(() => {
    const status = this.current().status;
    return status === 'starting' || status === 'waiting' || status === 'checking';
  });

  private stop: AbortController | null = null;
  private file: { blob: Blob; name: string; at: number } | null = null;

  constructor(
    readonly address: string,
    private readonly fallbackName: string,
    private readonly port: ReportPort
  ) {}

  /** Asks for the report, or follows the one already asked for. */
  ask(): void {
    if (this.busy()) return;
    this.stop = new AbortController();
    this.askedAt.set(this.port.now());
    this.current.set({ status: 'starting' });
    void this.follow(this.stop.signal);
  }

  /** Stops waiting for it; pdf-export goes on making it, kept for whoever asks next. */
  cancel(): void {
    this.stop?.abort();
    this.stop = null;
    this.current.set({ status: 'idle' });
  }

  /**
   * The check passed: its token exchanged for the site's human pass, then the report asked
   * for again. False when the exchange is refused, so the check is shown afresh; a check
   * that cannot be sent at all fails as "not checked".
   */
  async solve(captchaToken: string): Promise<boolean> {
    const phase = this.current();
    if (phase.status !== 'checking' || captchaToken === '') return false;
    let response: Response;
    try {
      response = await this.port.fetch(phase.challenge.verify, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken }),
      });
    } catch {
      if (this.current() === phase) this.current.set({ status: 'failed', failure: 'not_checked' });
      return false;
    }
    // cancelled while the check was sent
    if (this.current() !== phase) return true;
    if (!response.ok) return false;
    this.current.set({ status: 'idle' });
    this.ask();
    return true;
  }

  /** Saves the file again while it is kept, or asks for the report anew past that. */
  again(): void {
    if (this.file && this.port.now() - this.file.at < KEEP_MS) {
      this.port.save(this.file.blob, this.file.name);
      return;
    }
    this.file = null;
    this.current.set({ status: 'idle' });
    this.ask();
  }

  private async follow(signal: AbortSignal): Promise<void> {
    // read afresh each time: a cancel while a request is awaited ends it
    const stopped = (): boolean => signal.aborted;
    let lastAnswer = this.port.now();
    while (!stopped()) {
      let response: Response;
      try {
        response = await this.port.fetch(this.address, {
          headers: {
            Accept: 'application/pdf, application/json',
            Prefer: `wait=${String(HOLD_S)}`,
          },
          signal,
        });
      } catch {
        if (stopped()) return;
        // no answer: said unknown after the silence, asked again until then
        if (this.port.now() - lastAnswer >= SILENCE_MS) {
          this.current.set({ status: 'failed', failure: 'unreachable' });
          return;
        }
        await this.port.pause(AGAIN_MS, signal);
        continue;
      }
      lastAnswer = this.port.now();
      if (stopped()) return;
      if (response.status === 202) {
        const body: unknown = await response.json().catch(() => null);
        if (stopped()) return;
        // a pdf-export before spec 002 T029 says no more than that it is being made
        this.current.set({ status: 'waiting', report: statusOf(body) ?? { state: 'making' } });
        continue;
      }
      if (response.ok) {
        const blob = await response.blob();
        if (stopped()) return;
        const name = filenameFrom(response.headers.get('content-disposition'), this.fallbackName);
        this.file = { blob, name, at: this.port.now() };
        this.port.save(blob, name);
        this.current.set({ status: 'saved' });
        return;
      }
      if (response.status === 401) {
        const challenge = challengeOf(await response.json().catch(() => null));
        if (stopped()) return;
        this.current.set(
          challenge ? { status: 'checking', challenge } : { status: 'failed', failure: 'failed' }
        );
        return;
      }
      await response.body?.cancel().catch(() => undefined);
      this.current.set(failureOf(response));
      return;
    }
  }
}

/** A refusal's failure: the result gone, the service busy, or the report failed. */
function failureOf(response: Response): ReportPhase {
  if (response.status === 404 || response.status === 410) {
    return { status: 'failed', failure: 'gone' };
  }
  if (response.status === 503) {
    // the gateway's, where this deployment cannot check a person: the only 503 with no
    // Retry-After (spec 031, FR-020)
    if (response.headers.get('retry-after') === null)
      return { status: 'failed', failure: 'no_check' };
    const after = Number(response.headers.get('retry-after'));
    return {
      status: 'failed',
      failure: 'busy',
      ...(Number.isFinite(after) && after > 0 ? { retryAfter: after } : {}),
    };
  }
  return { status: 'failed', failure: 'failed' };
}

/** A 401's check to make, read field by field; undefined when it names none. */
function challengeOf(body: unknown): ReportChallenge | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const sitekey: unknown = (body as Record<string, unknown>)['sitekey'];
  const verify: unknown = (body as Record<string, unknown>)['verify'];
  if (typeof sitekey !== 'string' || sitekey === '') return undefined;
  // the site's own route, never an address elsewhere
  if (typeof verify !== 'string' || !verify.startsWith('/') || verify.startsWith('//'))
    return undefined;
  return { sitekey, verify };
}

const STAGES: readonly string[] = ['reading', 'figures', 'printing'];

/** A 202's status, read field by field: what is not of its shape is left out. */
export function statusOf(body: unknown): AnalysisReportStatus | undefined {
  if (typeof body !== 'object' || body === null || !('status' in body)) return undefined;
  const status: unknown = body.status;
  if (typeof status !== 'object' || status === null || !('state' in status)) return undefined;
  const state = status.state;
  if (state !== 'queued' && state !== 'making') return undefined;
  const count = (key: string): number | undefined => {
    const value: unknown = (status as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const stage: unknown = (status as Record<string, unknown>)['stage'];
  const read: AnalysisReportStatus = { state };
  const place = count('place');
  const done = count('done');
  const total = count('total');
  const estimate = count('estimate');
  if (place !== undefined) read.place = place;
  if (typeof stage === 'string' && STAGES.includes(stage)) {
    read.stage = stage as NonNullable<AnalysisReportStatus['stage']>;
  }
  if (done !== undefined) read.done = done;
  if (total !== undefined) read.total = total;
  if (estimate !== undefined) read.estimate = estimate;
  return read;
}
