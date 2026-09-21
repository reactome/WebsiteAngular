import { Injectable, computed, signal } from '@angular/core';
import {
  getProfile,
  SELECTED_PROFILE_NAME,
} from '../../../../website-angular/src/config/environments';
import {
  drainFrames,
  isDowngraded,
  isIncomplete,
  showsProse,
  type AnalysisType,
  type Citation,
  type Disclosure,
  type RefusalReason,
  type SummaryState,
} from './summary-stream';

/**
 * Asking for an analysis result to be summarised.
 *
 * The browser posts an analysis token to our own proxy, which mints the caller
 * token and reaches the chatbot; nothing here holds a key. The transport is the
 * search answer's, and so is the shape of this service -- signals the panel
 * reads, one request in flight at a time, and a terminal state that arrives in
 * the stream rather than in a status code.
 *
 * What is different is that the outcome means more here. An answer is either
 * prose or nothing; a summary can be prose, or a result that has expired and
 * can be re-run, or an analysis type nobody summarises yet. Those are different
 * things to offer a reader, so they are kept apart all the way to the template.
 */
const OVERALL_TIMEOUT_MS = 120_000;

/**
 * Outcomes worth remembering for the rest of the session.
 *
 * Each is a fact about the analysis rather than about one attempt at it: the
 * text itself, a result that has expired, one we have no record of, a kind we do
 * not summarise. `failed` and `refused` are the opposite -- they say something
 * about this moment, and remembering them would answer the next click from the
 * cache and never try again.
 */
const CACHEABLE = new Set<SummaryState>(['summarised', 'gone', 'not_found', 'unsupported']);

interface Cached {
  text: string;
  citations: Citation[];
  state: SummaryState;
  analysisType: AnalysisType | null;
  applied: Disclosure | null;
}

@Injectable({ providedIn: 'root' })
export class SummaryService {
  private readonly endpoint = getProfile(SELECTED_PROFILE_NAME).analysisSummaryEndpoint;

  /** Absent endpoint means the deployment does not offer summaries at all. */
  readonly available = !!this.endpoint;

  private readonly _asking = signal(false);
  private readonly _text = signal('');
  private readonly _citations = signal<Citation[]>([]);
  private readonly _state = signal<SummaryState | null>(null);
  private readonly _reason = signal<RefusalReason | null>(null);
  private readonly _analysisType = signal<AnalysisType | null>(null);
  private readonly _applied = signal<Disclosure | null>(null);
  private readonly _requested = signal<Disclosure>('aggregate');
  private readonly _challenge = signal<{ sitekey: string; verify: string } | null>(null);

  readonly asking = this._asking.asReadonly();
  readonly text = this._text.asReadonly();
  readonly state = this._state.asReadonly();
  readonly reason = this._reason.asReadonly();
  readonly analysisType = this._analysisType.asReadonly();
  readonly challenge = this._challenge.asReadonly();

  readonly citations = computed(() => this._citations());
  readonly visible = computed(() => showsProse(this._text()));
  readonly incomplete = computed(() => isIncomplete(this._state(), this._text()));

  /**
   * Whether the reader asked to disclose their identifiers and did not get it.
   *
   * Never true merely because there was nothing to disclose -- see
   * `isDowngraded`. A result where every identifier matched reports the
   * disclosing tier, because it was honoured.
   */
  readonly downgraded = computed(() => isDowngraded(this._requested(), this._applied()));

  /**
   * The result predates this release and can be run again.
   *
   * The only terminal state where the reader can act, which is why the panel
   * gives it a button and everything else a sentence.
   */
  readonly expired = computed(() => this._state() === 'gone');

  private release: number | null = null;
  private readonly cache = new Map<string, Cached>();
  private inFlight: AbortController | null = null;
  /** What to ask again for once a challenge is solved. */
  private _lastToken = '';

  /** Cancels whatever is in flight, so a second request cannot interleave. */
  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this._asking.set(false);
  }

  clear(): void {
    this.cancel();
    // Nothing left to retry: a challenge solved after switching analyses must
    // not summarise the one the reader has left.
    this._lastToken = '';
    this._text.set('');
    this._citations.set([]);
    this._state.set(null);
    this._reason.set(null);
    this._analysisType.set(null);
    this._applied.set(null);
    this._challenge.set(null);
  }

  async summarise(token: string, disclosure: Disclosure = 'aggregate'): Promise<void> {
    const analysis = token.trim();
    if (!this.endpoint || !analysis) return;

    this.cancel();
    this._lastToken = analysis;
    this._requested.set(disclosure);
    this._challenge.set(null);

    // Keyed on what is known *before* asking. `release` arrives in the `start`
    // event, so including it meant the first request stored under `unknown` and
    // every later one looked under `97` -- a cache that could never hit. It is
    // not needed anyway: this cache lives in one page's memory, and a release
    // during a session would replace the process that holds it.
    const key = `${analysis}::${disclosure}`;
    const cached = this.cache.get(key);
    if (cached) {
      // The service caches too -- byte-identical text for the same token -- but
      // its store is in process and beta deploys often, so this one spares a
      // reader who toggles disclosure back and forth a second wait for text
      // that cannot have changed within a session.
      this._text.set(cached.text);
      this._citations.set(cached.citations);
      this._state.set(cached.state);
      this._analysisType.set(cached.analysisType);
      this._applied.set(cached.applied);
      return;
    }

    this._text.set('');
    this._citations.set([]);
    this._state.set(null);
    this._reason.set(null);
    this._asking.set(true);

    const controller = new AbortController();
    this.inFlight = controller;
    const timer = setTimeout(() => controller.abort(), OVERALL_TIMEOUT_MS);

    try {
      await this.stream(this.endpoint, analysis, disclosure, controller.signal);
      const state = this._state();
      // Only outcomes that are facts about the analysis. `failed` and `refused`
      // are facts about this *attempt*: caching a rate-limited refusal means the
      // reader can never get a summary again in that session, because the next
      // click is answered from the cache without a request -- a transient
      // problem made permanent by the thing meant to make it faster.
      if (state && CACHEABLE.has(state)) {
        this.cache.set(key, {
          text: this._text(),
          citations: this._citations(),
          state,
          analysisType: this._analysisType(),
          applied: this._applied(),
        });
      }
    } catch {
      // Includes our own abort, which is why this is guarded. Clicking twice
      // aborts the first request, and its rejection lands *after* the second
      // has reset the state to null -- so an unguarded `failed` here is written
      // over a request that is still streaming perfectly well.
      if (this.inFlight === controller && this._state() === null) this._state.set('failed');
    } finally {
      clearTimeout(timer);
      // Both guarded, for the same reason: the first request's cleanup must not
      // turn off the second request's spinner.
      if (this.inFlight === controller) {
        this.inFlight = null;
        this._asking.set(false);
      }
    }
  }

  /**
   * Exchanges a solved challenge for an identity, then asks again.
   *
   * Returns false when the exchange is refused, so the panel can render a fresh
   * widget rather than leave the reader looking at a spent one.
   */
  async solve(captchaToken: string): Promise<boolean> {
    const challenge = this._challenge();
    const token = this._lastToken;
    if (!challenge || !captchaToken || !token) return false;
    try {
      const response = await fetch(challenge.verify, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken }),
      });
      if (!response.ok) return false;
    } catch {
      return false;
    }
    this._challenge.set(null);
    await this.summarise(token, this._requested());
    return true;
  }

  private async stream(
    endpoint: string,
    token: string,
    disclosure: Disclosure,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, disclosure }),
      signal,
    });

    // A challenge is not a failure: the server will answer once it knows a
    // human is asking.
    if (response.status === 401) {
      const body: unknown = await response.json().catch(() => null);
      const challenge = body as { sitekey?: unknown; verify?: unknown } | null;
      if (typeof challenge?.sitekey === 'string' && typeof challenge?.verify === 'string') {
        this._challenge.set({ sitekey: challenge.sitekey, verify: challenge.verify });
      } else {
        this._state.set('failed');
      }
      return;
    }

    // 422 is the proxy or the service rejecting the request itself -- a
    // malformed disclosure -- and carries JSON rather than events. Parsing it
    // as a stream would hang waiting for frames that never come.
    if (!response.ok || !response.body) {
      this._state.set('failed');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = drainFrames(buffer);
      buffer = rest;
      for (const event of events) {
        switch (event.kind) {
          case 'start':
            this.release = event.start.release;
            this._analysisType.set(event.start.analysisType);
            this._applied.set(event.start.disclosure);
            break;
          case 'token':
            this._text.update((text) => text + event.text);
            break;
          case 'citation':
            this._citations.update((list) => [...list, event.citation]);
            break;
          case 'done':
            this._state.set(event.state);
            this._reason.set(event.reason);
            break;
        }
      }
    }
  }
}
