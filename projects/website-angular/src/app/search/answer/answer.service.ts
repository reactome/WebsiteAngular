/**
 * Asks the answer endpoint a question and streams the reply back.
 *
 * Deliberately `fetch` rather than `HttpClient`: this is server-sent events
 * over a POST, and we need the body as it arrives. The parsing is in
 * `answer-stream.ts`, which is where the tests are.
 *
 * Three things this service must never do, because the panel is meant to be
 * safe to ignore (`specs/005-search-page-answers/research.md`, D4):
 *
 *   * surface an error to the reader -- every failure ends as "no panel"
 *   * let the search results wait on it
 *   * call the chatbot directly -- the endpoint is our own proxy, which is what
 *     holds the signing key for the caller token
 */
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { getProfile, SELECTED_PROFILE_NAME } from '../../../config/environments';
import {
  cacheKey,
  citationKey,
  drainFrames,
  isIncomplete,
  MAX_CITATIONS,
  showsProse,
  type AnswerState,
  type Citation,
} from './answer-stream';

interface CachedAnswer {
  text: string;
  citations: Citation[];
  state: AnswerState;
  answerId: string | null;
  answeredAt: number | null;
}

/**
 * How long the chat keeps an answer to continue from: an hour from when it was
 * produced (the handoff contract). Past that the button would only fail.
 */
export const ANSWER_ID_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Our own ceiling, above the server's stated 120s.
 *
 * The server sends `done`/`failed` when it gives up, but a dropped connection
 * sends nothing at all, and without this the panel would sit in its asking
 * state forever. Above 120s rather than below so that a slow-but-working answer
 * is not cut off by us -- p90 to complete is 18.1s, so this is far out.
 */
const OVERALL_TIMEOUT_MS = 130_000;

/**
 * Deliberately **not** `providedIn: 'root'`.
 *
 * The panel is provided by `SearchAnswerComponent`, so this dies with it. Root
 * scope was a bug: the panel unmounts the moment the reader types into the
 * search box -- `onQueryInput` sets `searchSubmitted = false`, which closes the
 * `@if` around it -- and a root-scoped service kept streaming after that. The
 * reader would have left a model call running by starting to type, which is
 * exactly what closing the connection is supposed to prevent. It also carried
 * one page's answer to the next.
 */
@Injectable()
export class AnswerService {
  private readonly endpoint = getProfile(SELECTED_PROFILE_NAME).searchAnswerEndpoint;

  /** Whether this deployment offers answers at all. Absent endpoint means no. */
  readonly available = !!this.endpoint;

  private readonly _asking = signal(false);
  private readonly _text = signal('');
  private readonly _citations = signal<Citation[]>([]);
  private readonly _state = signal<AnswerState | null>(null);
  private readonly _question = signal('');
  /** The chat's handle on this answer, from `done`, and when it arrived. */
  private readonly _answerId = signal<string | null>(null);
  private readonly _answeredAt = signal<number | null>(null);

  /**
   * Set when the server will not answer until it knows a human is asking.
   *
   * Carries the sitekey rather than the panel holding one: the server decides
   * whether a challenge is needed and which key to render, so a deployment can
   * change either without a rebuild, and the widget is never rendered when it
   * is not wanted.
   */
  private readonly _challenge = signal<{ sitekey: string; verify: string } | null>(null);

  readonly asking = this._asking.asReadonly();
  readonly text = this._text.asReadonly();
  readonly state = this._state.asReadonly();
  readonly question = this._question.asReadonly();
  readonly answerId = this._answerId.asReadonly();
  readonly answeredAt = this._answeredAt.asReadonly();
  readonly challenge = this._challenge.asReadonly();

  /** Capped and de-duplicated: the server's cap binds on ordinary questions. */
  readonly citations = computed(() => this._citations().slice(0, MAX_CITATIONS));

  /** Whether there is anything to show -- including mid-stream. */
  readonly visible = computed(() => showsProse(this._text()));

  /** Whether what is shown stopped early, and should say so. */
  readonly incomplete = computed(() => isIncomplete(this._state(), this._text()));

  /**
   * The release the last `start` event named, used to key the cache.
   *
   * Null until the first answer of a session arrives, which is why `remember`
   * stores an entry under both the known and the unknown key.
   */
  private release: number | null = null;
  private readonly cache = new Map<string, CachedAnswer>();
  private inFlight: AbortController | null = null;

  constructor() {
    // Leaving the component is a cancellation, the same as a new search is.
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  /**
   * Abandons whatever is in flight.
   *
   * Closing the connection *is* the cancellation: a client hang-up raises
   * CancelledError inside their generator and nothing further is produced, so
   * there is no upstream cancel call to make. Measured by the chatbot team.
   */
  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this._asking.set(false);
  }

  /**
   * Forget the chat's handle on this answer: the chat no longer has it (after a
   * chat deploy, or once its hour is up), so offering to continue from it can
   * only fail again. Dropped from the page cache too, or asking the same
   * question would bring the dead handle back.
   */
  forgetAnswerId(): void {
    const id = this._answerId();
    this._answerId.set(null);
    this._answeredAt.set(null);
    // Only this answer's: other cached answers keep their own handles.
    for (const entry of this.cache.values()) {
      if (id !== null && entry.answerId === id) {
        entry.answerId = null;
        entry.answeredAt = null;
      }
    }
  }

  reset(): void {
    this.cancel();
    this._challenge.set(null);
    this._text.set('');
    this._citations.set([]);
    this._state.set(null);
    this._question.set('');
    this._answerId.set(null);
    this._answeredAt.set(null);
  }

  async ask(question: string): Promise<void> {
    const asked = question.trim();
    if (!this.endpoint || !asked) return;

    this.cancel();
    this._question.set(asked);
    this._citations.set([]);
    this._challenge.set(null);

    const cached = this.cache.get(cacheKey(asked, this.release));
    if (cached) {
      // Answers are not reproducible, so a reader who asks the same thing twice
      // -- or reloads -- must see the same panel rather than a different one.
      this._text.set(cached.text);
      this._citations.set(cached.citations);
      this._state.set(cached.state);
      this._answerId.set(cached.answerId);
      this._answeredAt.set(cached.answeredAt);
      return;
    }

    this._text.set('');
    this._state.set(null);
    this._answerId.set(null);
    this._answeredAt.set(null);
    this._asking.set(true);

    const controller = new AbortController();
    this.inFlight = controller;
    const timer = setTimeout(() => controller.abort(), OVERALL_TIMEOUT_MS);

    try {
      await this.stream(this.endpoint, asked, controller.signal);
    } catch {
      // Includes our own abort, which is why this is guarded. Asking a second
      // question aborts the first, and its rejection lands *after* the second
      // has reset the state to null -- so an unguarded `failed` here is written
      // over a request that is still streaming perfectly well.
      if (this.inFlight === controller && this._state() === null) this._state.set('failed');
    } finally {
      clearTimeout(timer);
      // Guarded for the same reason: the first question's cleanup must not turn
      // off the second question's spinner.
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
   * widget rather than leaving the reader looking at a spent one.
   */
  async solve(token: string): Promise<boolean> {
    const challenge = this._challenge();
    if (!challenge || !token) return false;
    try {
      const response = await fetch(challenge.verify, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken: token }),
      });
      if (!response.ok) return false;
    } catch {
      return false;
    }
    const question = this._question();
    this._challenge.set(null);
    await this.ask(question);
    return true;
  }

  private async stream(endpoint: string, question: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The proxy mints the caller token; the browser has no key and sends none.
      body: JSON.stringify({ question }),
      signal,
    });

    // The endpoint answers 200 for every outcome, so a non-200 is the proxy or
    // the network, not an answer. Either way: no panel.
    // A challenge is not a failure: the server is willing to answer once it
    // knows a human is asking. The panel renders the widget and asks again.
    if (response.status === 401) {
      const body = await response.json().catch(() => null);
      if (typeof body?.sitekey === 'string' && typeof body?.verify === 'string') {
        this._challenge.set({ sitekey: body.sitekey, verify: body.verify });
      } else {
        this._state.set('failed');
      }
      return;
    }

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
      const drained = drainFrames(buffer);
      buffer = drained.rest;
      for (const event of drained.events) {
        switch (event.kind) {
          case 'start':
            this.release = event.release;
            break;
          case 'token':
            this._text.update((text) => text + event.text);
            break;
          case 'citation':
            this._citations.update((list) =>
              list.some((c) => citationKey(c) === citationKey(event.citation))
                ? list
                : [...list, event.citation]
            );
            break;
          case 'done':
            this._state.set(event.state);
            if (event.answerId) {
              this._answerId.set(event.answerId);
              this._answeredAt.set(Date.now());
            }
            break;
        }
      }
    }

    // A stream that ends without `done` is a dropped connection: `failed`, and
    // whatever prose arrived stays on screen marked incomplete rather than being
    // taken back from a reader who was reading it.
    if (this._state() === null) this._state.set('failed');
    this.remember(question);
  }

  /**
   * Caches outcomes worth repeating, and only those.
   *
   * `answered` is the answer itself. `nothing_found` and `refused` are stable
   * properties of the question -- a reader who asks something off-topic, sees
   * nothing, and clicks again should not pay for a second model call to be told
   * the same nothing.
   *
   * `failed` is never cached, with or without prose. It is a fault rather than
   * an outcome: the 120s ceiling, a mid-generation exception, a dropped
   * connection. Caching it would turn "ask again" into "replay the truncation",
   * which is the one thing a reader looking at a half answer actually needs not
   * to happen.
   */
  private remember(question: string): void {
    const state = this._state();
    if (state === null || state === 'failed') return;
    const entry: CachedAnswer = {
      text: this._text(),
      citations: this._citations(),
      state,
      answerId: this._answerId(),
      answeredAt: this._answeredAt(),
    };
    this.cache.set(cacheKey(question, this.release), entry);
    // Also under the unknown-release key, for a session where no `start` event
    // ever arrives: lookups would keep computing the unknown key and keep
    // missing an answer we already have. Harmless when the release is known,
    // since lookups then use that key and find the same entry.
    if (this.release !== null) this.cache.set(cacheKey(question, null), entry);
  }
}
