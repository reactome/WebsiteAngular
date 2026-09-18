/**
 * The AI answer panel on the search page.
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
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { marked } from 'marked';
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
  readonly asking = this.answers.asking;
  readonly visible = this.answers.visible;
  readonly incomplete = this.answers.incomplete;
  readonly citations = this.answers.citations;

  /**
   * True once the reader has asked about *this* query.
   *
   * Comparing the asked question with the current one is what makes a new
   * search put the panel away: the answer to the previous query must not sit
   * above results for a different one.
   */
  readonly askedThisQuery = computed(
    () => this.answers.question() !== '' && this.answers.question() === this.query().trim()
  );

  /**
   * The invitation comes back whenever there is nothing on screen.
   *
   * Hiding it on `askedThisQuery` alone was wrong: an outcome with no prose --
   * `nothing_found`, a refusal -- left the button gone and no panel in its
   * place, so the reader's click visibly did nothing at all and could not be
   * retried. A repeat click is free anyway, since every outcome is cached.
   */
  readonly showButton = computed(() => this.available && !this.visible() && !this.asking());

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
    const raw = this.answers.text();
    if (!raw) return '';
    const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return marked.parse(escaped, { async: false }) as string;
  });

  constructor() {
    // A new search abandons an answer in flight. Closing the connection is the
    // cancellation, so this also stops the server working on something nobody
    // is waiting for.
    effect(() => {
      const query = this.query().trim();
      if (query && this.answers.question() && this.answers.question() !== query) {
        this.answers.reset();
      }
    });
  }

  ask(): void {
    void this.answers.ask(this.query());
  }
}
