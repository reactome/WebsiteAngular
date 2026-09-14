import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule } from '@angular/forms';
import { UrlStateService } from '../../services/url-state.service';
import { InteractorService } from '../services/interactor.service';
import { clampThreshold } from '../interactor-threshold';
import { interactorFilename, interactorsToTsv } from '../interactor-export';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * How confident an interaction has to be before it is drawn.
 *
 * The old browser has this and we did not, which is one of the two rows a curator
 * cannot sign off (RELEASE-TESTING.md:117). A well-studied entity brings back
 * more interactors than its diagram has room for -- 73 for BHLHE40 on
 * R-HSA-1368108, measured -- and without a threshold there is nothing to do about
 * that but look away.
 *
 * The value lives in the URL rather than here, so it survives a reload and
 * travels in a shared link. `data-threshold` carries it on the host element so a
 * test can read what is in force without inspecting a slider's pixel position.
 */
@Component({
  selector: 'cr-interactor-threshold',
  standalone: true,
  imports: [MatSliderModule, FormsModule, MatButtonModule, MatIconModule],
  templateUrl: './interactor-threshold.component.html',
  styleUrl: './interactor-threshold.component.scss',
  host: { '[attr.data-threshold]': 'threshold()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InteractorThresholdComponent {
  private readonly state = inject(UrlStateService);
  private readonly interactors = inject(InteractorService);

  /**
   * Whether the threshold, rather than the data, is why nothing is drawn.
   *
   * A diagram with no interactors on it looks the same either way, and the reader
   * who has just dragged a slider deserves to be told which it is.
   */
  readonly hiddenByThreshold = computed(() => {
    const { shown, drawn } = this.interactors.interactorCounts();
    return drawn > 0 && shown === 0;
  });

  /**
   * Where each interaction sits on the track, as a percentage from the left.
   *
   * One mark per interaction rather than a summary, so a cluster reads as a
   * cluster: dragging into a dense band removes many at once, and dragging
   * through an empty stretch does nothing. Without them the reader is moving a
   * control with no idea what is about to happen.
   *
   * Marks at or above the threshold are the ones still drawn, which lets the
   * track double as a preview of the change.
   */
  readonly marks = computed(() => {
    const threshold = this.threshold();
    return this.interactors.openedScores().map((score) => ({
      score,
      left: `${(score * 100).toFixed(2)}%`,
      kept: score >= threshold,
    }));
  });

  /**
   * What is on the diagram against what exists, when they differ.
   *
   * A badge reading 47 beside a dozen drawn interactors is a contradiction the
   * reader cannot resolve on their own: the diagram has room for 18
   * (MAX_INTERACTORS) and the threshold may hide more. Saying so is cheaper than
   * making them count.
   */
  readonly tally = computed(() => {
    const { shown, offered } = this.interactors.interactorCounts();
    if (offered === 0 || shown === offered) return null;
    return `${shown} of ${offered}`;
  });

  readonly threshold = computed(() => clampThreshold(this.state.interactorScore()));

  /** Shown to two places, which is the precision the scores themselves carry. */
  readonly label = computed(() => this.threshold().toFixed(2));

  set(value: number) {
    this.state.interactorScore.set(clampThreshold(value));
  }

  /**
   * While the thumb is moving, not only when it is let go.
   *
   * Material commits `valueChange` at the end of a drag, so the diagram lagged
   * behind the control and the marks on the track could not be used for what they
   * are for -- watching interactors leave as the thumb passes them.
   *
   * `input` alone, not both. Bound together they raced on release: `valueChange`
   * fires afterwards with Material's own value, which can be the one before the
   * last `input`, so letting go sometimes put the threshold back a step and left
   * the message describing a state the diagram was no longer in. `input` fires on
   * the release too, so nothing is lost by dropping it.
   */
  /**
   * Put the interactors away, and this bar with them.
   *
   * The bar describes a set of interactors, so dismissing it and clearing them
   * are one act: a bar left behind describing nothing is the confusing half.
   *
   * The overlay resource is left alone -- the reader chose it, and clearing that
   * too would answer a question they did not ask.
   */
  dismiss() {
    this.interactors.closeAllInteractors();
  }

  onSlide(event: Event) {
    const input = event.target as HTMLInputElement | null;
    if (input) this.set(Number(input.value));
  }

  /**
   * Available whenever an entity is open, threshold or no threshold.
   *
   * The file carries everything that entity has, so a threshold that has emptied
   * the diagram does not empty the download -- which is the moment a reader is
   * most likely to want the data in a spreadsheet instead.
   */
  readonly canDownload = computed(() => this.interactors.exportableInteractions().length > 0);

  /**
   * Save what is on the diagram.
   *
   * Assembled here from data already held, so there is no request, no progress to
   * report and nothing to fail -- which is why this does not use
   * FileDownloadService, whose whole purpose is the states a server download has.
   *
   * The object URL is revoked. The participant export beside this one does not,
   * and leaks one per download for the life of the page.
   */
  download() {
    const rows = this.interactors.exportableInteractions();
    if (rows.length === 0) return;

    const blob = new Blob([interactorsToTsv(rows)], { type: 'text/tab-separated-values' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = interactorFilename(
      this.state.pathwayId() ?? null,
      this.interactors.currentResource().name
    );
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }
}
