import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './analysis-summary.component.html',
  styleUrl: './analysis-summary.component.scss',
})
export class AnalysisSummaryComponent {
  readonly summary = inject(SummaryService);

  /** The analysis token whose result is on screen. */
  readonly token = input.required<string>();

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
        return this.summary.reason() === 'rate_limited'
          ? 'Too many summaries requested just now. Try again shortly.'
          : 'A summary is not available for this result.';
      case 'failed':
        return 'The summary could not be produced.';
      default:
        return null;
    }
  });

  constructor() {
    // The service is a singleton, so without this a summary outlives the result
    // it was written about: summarise analysis A, switch to analysis B, and A's
    // text sits under B's heading attributed to B's data. Worse than an empty
    // panel, because it is wrong rather than absent.
    let previous: string | null = null;
    effect(() => {
      const token = this.token();
      if (previous !== null && token !== previous) this.summary.clear();
      previous = token;
    });
  }

  async ask(): Promise<void> {
    await this.summary.summarise(this.token());
  }
}
