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
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { renderChallenge } from '../../../../website-angular/src/app/search/answer/turnstile';
import {
  provenance as describeProvenance,
  recipientNote as describeRecipient,
  waitingMessage as describeWait,
} from './panel-copy';
import { clearSummaryForOtherResults } from './summary-owner';
import { SummaryService } from './summary.service';
import { type AnalysisType } from './summary-stream';

/**
 * What the summary is allowed to claim, per analysis type.
 *
 * A copy constraint rather than a styling one, and the reason this table exists
 * instead of one heading.
 *
 * An over-representation result says which pathways contain more of the
 * submitted identifiers than chance would give. It carries no direction,
 * magnitude or regulation, and the summary is explicitly forbidden from saying
 * up, down, increased or activated. Heading that panel "what changed" would
 * promise something the text cannot deliver — and a reader would supply the
 * missing meaning themselves and read enrichment as up-regulation.
 *
 * A species comparison is about inference rather than observation: its findings
 * are projected by orthology, and the summary says so, because that distinction
 * is the whole content of that result type.
 */
const HEADINGS: Record<AnalysisType, { title: string; note: string }> = {
  OVERREPRESENTATION: {
    title: 'What your identifiers are enriched in',
    note: 'Enrichment says which pathways contain more of your identifiers than chance would give. It says nothing about direction.',
  },
  EXPRESSION: {
    title: 'How your values behave across the columns',
    note: 'Columns are described in the order you submitted them.',
  },
  SPECIES_COMPARISON: {
    title: 'What is inferred for this species',
    note: 'These findings are inferred by orthology rather than observed in this species.',
  },
};

@Component({
  selector: 'cr-analysis-summary',
  standalone: true,
  imports: [MatIcon, MatIconButton, MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analysis-summary.component.html',
  styleUrl: './analysis-summary.component.scss',
})
export class AnalysisSummaryComponent {
  readonly summary = inject(SummaryService);

  /** The analysis token whose result is on screen. */
  readonly token = input.required<string>();

  /**
   * Whether this kind of result can be summarised at all.
   *
   * The three ReactomeGSA types cannot, and the result tab already knows which
   * it is holding. Without this the button is offered, the reader waits for a
   * request to be made and refused, and is then told we do not summarise this
   * kind — information we had before they clicked.
   */
  readonly summarisable = input(true);

  /**
   * The heading, which depends on what kind of result this is.
   *
   * Null until the `start` event says — the panel shows its spinner under no
   * heading rather than under a guessed one, because the wrong heading is a
   * claim about the result.
   */
  readonly heading = computed(() => {
    const type = this.summary.analysisType();
    return type ? HEADINGS[type] : null;
  });

  /**
   * Why there is no summary, in the reader's terms.
   *
   * `gone` is deliberately absent: it is not a reason, it is an action, and the
   * template gives it a button.
   */
  readonly explanation = computed(() => {
    switch (this.summary.state()) {
      case 'not_found':
        return 'We have no record of this analysis.';
      case 'unsupported':
        return 'We do not summarise this kind of analysis yet.';
      case 'refused':
        // Each reason is a different thing to do about it, and the two
        // verification ones are not "unavailable" -- they are "not yet", which
        // the reader can change. Saying "a summary is not available for this
        // result" to somebody whose session has merely gone stale sends them
        // away from something that would work on a retry.
        switch (this.summary.reason()) {
          case 'rate_limited':
            return 'Too many summaries requested just now. Try again shortly.';
          case 'no_human':
          case 'no_caller':
          case 'stale_human':
            // No longer the common path, and the copy no longer sends anybody
            // to the search page. The proxy asks for a *fresh* check before it
            // forwards, so an expired one now produces the widget above rather
            // than this. Reaching this means the two ends disagree about the
            // claim -- a clock, or a bound changed on one side only -- and the
            // one thing a reader can usefully do about that is ask again,
            // which the button beside this offers.
            return 'The check that somebody is here did not carry through.';
          case 'unsupported_tier':
            return 'That level of detail is not available for this result.';
          default:
            return 'A summary is not available for this result.';
        }
      case 'failed':
        return 'The summary could not be produced.';
      default:
        return null;
    }
  });

  /**
   * Whether asking again could plausibly work.
   *
   * The presence refusals only: a second request re-runs the gate, and the
   * proxy answers those with a challenge the reader can solve here. Not
   * `rate_limited`, where asking again is exactly the wrong advice, and not
   * `failed` -- an immediate retry button on an unexplained failure invites
   * clicking at a service that has just told us it could not do the work.
   */
  readonly retryable = computed(() => {
    if (this.summary.state() !== 'refused') return false;
    const reason = this.summary.reason();
    return reason === 'no_human' || reason === 'no_caller' || reason === 'stale_human';
  });

  /**
   * Seconds since the summary was asked for, while waiting.
   *
   * The same choice as the search answer's: a real elapsed count rather than a
   * bar filling at a guessed rate. The numbers differ, so the copy beside it
   * does -- this endpoint's first token lands at about 1.8s and a whole summary
   * took 4.5s when measured, against roughly ten seconds for an answer, so
   * borrowing "usually about ten" would have been wrong in the reassuring
   * direction.
   */
  private readonly _elapsed = signal(0);
  readonly elapsed = this._elapsed.asReadonly();

  private readonly tick = effect((onCleanup) => {
    if (!this.summary.asking()) {
      this._elapsed.set(0);
      return;
    }
    const started = Date.now();
    const handle = setInterval(() => {
      this._elapsed.set(Math.round((Date.now() - started) / 1000));
    }, 1000);
    onCleanup(() => clearInterval(handle));
  });

  /** @see waitingMessage -- the judgement lives there, where it can be tested. */
  readonly waitingMessage = computed(() => describeWait(this.summary.started()));

  /** Whether the "how this was made" note is open. */
  readonly howOpen = signal(false);

  /**
   * Whether the button that offers a summary is on screen.
   *
   * Its own name because two things need it: the button block, and the note
   * below, which may only appear beside something it explains.
   */
  readonly offering = computed(
    () =>
      this.summarisable() &&
      !this.summary.asking() &&
      !this.summary.state() &&
      !this.summary.challenge()
  );

  /**
   * Whether the note has anything to sit under.
   *
   * `howOpen` survives the thing that opened it -- a reader opens it beside the
   * button, asks, and the request fails -- and without this the note rendered
   * on its own: an explanation of what gets sent, floating above an error,
   * with no button and no summary anywhere near it.
   */
  readonly showHow = computed(
    () => this.howOpen() && (this.offering() || (this.summary.visible() && !!this.heading()))
  );

  /** @see recipientNote -- names the third party, which "AI" does not. */
  readonly recipientNote = describeRecipient;

  /** @see provenance -- reads the *applied* tier, never the requested one. */
  readonly provenance = computed(() => describeProvenance(this.summary.applied()));

  /** Anything written or said about the result, as opposed to the offer to write it. */
  readonly closable = computed(
    () =>
      this.summary.visible() ||
      this.summary.expired() ||
      !!this.explanation() ||
      !!this.summary.challenge() ||
      this.summary.asking()
  );

  close(): void {
    this.howOpen.set(false);
    this.summary.clear();
  }

  toggleHow(): void {
    this.howOpen.update((open) => !open);
  }

  constructor() {
    clearSummaryForOtherResults(this.summary, this.token);
  }

  /** The widget's container, present only while a challenge is being shown. */
  private readonly widget = viewChild<ElementRef<HTMLElement>>('turnstile');

  /**
   * Renders the challenge here, where the reader is.
   *
   * The first version told them to go and use the answer panel on the search
   * page and come back. That was honest about the state and a poor thing to ask
   * of somebody who has just run an analysis — sending a reader to a different
   * feature to unlock this one. The check belongs next to the thing it guards.
   */
  private readonly showChallenge = effect(() => {
    const challenge = this.summary.challenge();
    const host = this.widget()?.nativeElement;
    if (!challenge || !host || host.childElementCount > 0) return;
    void renderChallenge(host, challenge.sitekey, (token) => this.summary.solve(token));
  });

  async ask(): Promise<void> {
    await this.summary.summarise(this.token());
  }
}
