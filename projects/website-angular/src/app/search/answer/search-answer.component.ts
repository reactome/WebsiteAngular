/**
 * The React-to-Me answer panel on the search page.
 *
 * Opt-in behind a click, and never automatic. First token is p50 9.6s and
 * complete is p90 18.1s (measured by the chatbot team, fifteen questions, two
 * runs each), so nothing here starts without being asked for and the search
 * results never wait on it. The click is also the abuse control that lets the
 * caller token stop claiming to prove humanity: bots do not click, so a crawled
 * search URL costs no model call. `specs/005-search-page-answers/research.md`,
 * D5.
 *
 * No spinner that implies an imminent answer -- the contract is explicit that
 * ten seconds is the wrong latency for one.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { marked } from 'marked';
import { citationHref, citationKey, stripTrailingSources } from './answer-stream';

/** Cloudflare's widget, loaded only when a challenge is actually asked for. */
interface Turnstile {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void }): string;
}
import { AnswerService } from './answer.service';

@Component({
  selector: 'app-search-answer',
  templateUrl: './search-answer.component.html',
  styleUrls: ['./search-answer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Scoped here rather than to the root injector, so an answer in flight is
  // abandoned when this component goes -- which happens as soon as the reader
  // types into the search box.
  providers: [AnswerService],
})
export class SearchAnswerComponent {
  private readonly answers = inject(AnswerService);

  /** The query the results on screen are for. */
  readonly query = input.required<string>();

  readonly available = this.answers.available;
  readonly challenge = this.answers.challenge;
  readonly asking = this.answers.asking;
  readonly visible = this.answers.visible;
  readonly incomplete = this.answers.incomplete;
  readonly citations = this.answers.citations;

  /**
   * Asked, and there is genuinely no answer -- as distinct from not yet asked.
   *
   * Only `nothing_found` and `refused` count, because those are settled
   * properties of the question and are cached. `failed` is a fault, so it is
   * left to the button below, where asking again really re-asks.
   */
  readonly noAnswer = computed(() => {
    const state = this.answers.state();
    return !this.visible() && (state === 'nothing_found' || state === 'refused');
  });

  /**
   * The invitation, shown when asking again could achieve something.
   *
   * Three mistakes this has had to fix in turn. Hiding it once this query had
   * been asked left an outcome with no prose with neither button nor panel, so
   * the click visibly did nothing. Showing it whenever nothing was on screen
   * then made it a *dead* button: a second click on a cached `nothing_found`
   * returns from the cache before `asking` is ever set, so absolutely nothing
   * changes on screen -- an unresponsive control, which is worse than the quiet
   * nothing it was trying to preserve. And an answer that stopped early is the
   * one case where re-asking is most clearly worth it, yet `visible()` is true
   * then, so the button would have stayed hidden over a half answer.
   *
   * So: not while asking, not when the question has a settled non-answer, and
   * otherwise whenever there is nothing to show or what is shown stopped early.
   */
  readonly showButton = computed(
    () =>
      this.available &&
      !this.asking() &&
      !this.noAnswer() &&
      // A pending challenge is not an invitation to ask again: the question has
      // been asked, and the server wants proof of a human before answering it.
      // Without this the 401 put the button back -- `asking` had gone false and
      // no prose had arrived -- so the invitation won the branch chain, the
      // widget was never reached, and clicking again just earned another 401.
      !this.challenge() &&
      (!this.visible() || this.incomplete())
  );

  /**
   * The prose, as Markdown.
   *
   * Two layers, and neither is decorative:
   *
   *   * `<` and `&` are escaped before Markdown runs, so any HTML arriving in
   *     the stream is shown as text rather than interpreted. The contract says
   *     the prose is Markdown and never HTML; this makes that a property of our
   *     renderer instead of a promise we are trusting.
   *   * the result is bound as a plain string, so Angular's own sanitiser runs
   *     on it. Deliberately *not* `bypassSecurityTrustHtml`, which would turn
   *     that layer off -- the whole point is to render text we did not write.
   *
   * Markdown's own output survives sanitising: headings, lists, emphasis, code
   * and links all remain.
   */
  readonly html = computed(() => {
    const raw = stripTrailingSources(this.answers.text());
    if (!raw) return '';
    const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return marked.parse(escaped, { async: false }) as string;
  });

  /**
   * Long answers start collapsed, so they cannot bury the search results.
   *
   * Reported from use: the panel sits above the results and a full answer runs
   * to a few thousand characters, which is enough that a reader may not notice
   * the results are there at all. The results are the page; this is an aside.
   */
  private readonly _expanded = signal(false);
  readonly expanded = this._expanded.asReadonly();

  /**
   * Whether there is enough text for collapsing to be worth doing.
   *
   * Measured against a real answer: "What happens in the Golgi during N-glycan
   * maturation?" produced 2821 characters. A short answer collapsing would add
   * a control for no reason.
   */
  readonly collapsible = computed(() => stripTrailingSources(this.answers.text()).length > 900);

  readonly clamped = computed(() => this.collapsible() && !this._expanded());

  toggle(): void {
    this._expanded.update((open) => !open);
  }

  /**
   * Sources are shown as a few compact chips rather than a full list.
   *
   * Twelve names in a bulleted list is longer than the answer's own closing
   * paragraph, which made the panel look like it was mostly bibliography. A
   * handful of chips plus a count reads as "here are the main ones, there are
   * more" without spending the vertical space -- and the count is what
   * communicates that the list is a selection rather than everything.
   */
  private static readonly CHIPS_SHOWN = 4;
  private readonly _allSources = signal(false);
  readonly allSources = this._allSources.asReadonly();

  readonly visibleCitations = computed(() =>
    this._allSources()
      ? this.citations()
      : this.citations().slice(0, SearchAnswerComponent.CHIPS_SHOWN)
  );

  readonly hiddenSourceCount = computed(
    () => this.citations().length - this.visibleCitations().length
  );

  showAllSources(): void {
    this._allSources.set(true);
  }

  /** The widget's container, present only while a challenge is being shown. */
  private readonly widget = viewChild<ElementRef<HTMLElement>>('turnstile');

  /**
   * Renders the challenge when the server asks for one, and never before.
   *
   * The script is fetched on demand rather than on page load: most readers
   * never ask for an answer, and none of them should pay for Cloudflare's
   * widget just in case. `render=explicit` so it does not hunt the page for
   * containers of its own accord.
   */
  private readonly showChallenge = effect(() => {
    const challenge = this.challenge();
    const host = this.widget()?.nativeElement;
    if (!challenge || !host || host.childElementCount > 0) return;
    void this.renderWidget(host, challenge.sitekey);
  });

  private async renderWidget(host: HTMLElement, sitekey: string): Promise<void> {
    try {
      await loadTurnstile();
    } catch {
      // No widget means no way to prove anything, so the panel simply stays as
      // it is. Nothing here is worth an error message to a reader who only
      // wanted a search.
      return;
    }
    const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (!turnstile) return;
    turnstile.render(host, {
      sitekey,
      callback: (token: string) => {
        void this.answers.solve(token);
      },
    });
  }

  /** A stable id resolves to its detail page; a documentation page is its url. */
  readonly href = citationHref;
  readonly key = citationKey;

  /**
   * Where to carry the question on to a conversation.
   *
   * `/chat/guest/`, not `/chat/`. The latter is a chooser page offering guest
   * and personal, so it lands the reader a step short of a conversation; guest
   * is the one a public search page should open, and it is the same app the
   * answer endpoint belongs to.
   *
   * The question is **not** in the URL, and that is a limitation rather than a
   * choice. The chat cannot receive it: the only `searchParams` handling in the
   * shipped bundle tests filenames for `.pdf`, so a `?q=` would be silently
   * ignored -- a link that looks as though it carries the question and does
   * not. Raised with the chatbot team; if they add a way to accept one, this
   * becomes the place to pass it.
   */
  readonly chatUrl = '/chat/guest/';

  constructor() {
    // Clears an answer when the reader searches for something else.
    //
    // This is **not** redundant with the component being destroyed, which was
    // my reasoning for deleting it in #247 and was wrong. The search page reuses
    // this component across searches: `onQueryInput` sets
    // `searchSubmitted = false`, which would close the `@if` around us -- but it
    // sets a plain field and never calls `markForCheck`, and the page is
    // zoneless, so no change detection runs and the `@if` is never
    // re-evaluated. The component survives the whole way through.
    //
    // Reproduced before fixing: search apoptosis, ask, then search TP53 from
    // the bar. The panel kept showing the apoptosis answer above 3435 results
    // for TP53, with no button to ask about the new query. A reader could read
    // an answer about one thing believing it was about another, which is worse
    // than the panel simply being absent.
    effect(() => {
      const current = this.query().trim();
      const answered = this.answers.question();
      if (current && answered && answered !== current) {
        this.answers.reset();
        this._expanded.set(false);
        this._allSources.set(false);
      }
    });
  }

  ask(): void {
    this._expanded.set(false);
    this._allSources.set(false);
    void this.answers.ask(this.query());
  }
}

/**
 * Loads Cloudflare's widget script once, on demand.
 *
 * Module-level rather than per-instance so two panels on a page cannot race to
 * insert the same script twice.
 */
let turnstileScript: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise<void>((resolve, reject) => {
    if ((window as unknown as { turnstile?: unknown }).turnstile) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later attempt rather than caching the failure forever.
      turnstileScript = null;
      reject(new Error('turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return turnstileScript;
}
