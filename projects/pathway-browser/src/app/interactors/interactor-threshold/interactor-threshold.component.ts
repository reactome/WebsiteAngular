import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule } from '@angular/forms';
import { UrlStateService } from '../../services/url-state.service';
import { InteractorService } from '../services/interactor.service';
import { clampThreshold } from '../interactor-threshold';

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
  imports: [MatSliderModule, FormsModule],
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
    const { shown, total } = this.interactors.interactorCounts();
    return total > 0 && shown === 0;
  });

  readonly threshold = computed(() => clampThreshold(this.state.interactorScore()));

  /** Shown to two places, which is the precision the scores themselves carry. */
  readonly label = computed(() => this.threshold().toFixed(2));

  set(value: number) {
    this.state.interactorScore.set(clampThreshold(value));
  }
}
