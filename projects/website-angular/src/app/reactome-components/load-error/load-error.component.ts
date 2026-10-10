import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * What a section says when the request behind it failed.
 *
 * Distinct from the section's own "nothing here" text on purpose: a failed
 * request used to be shown as an empty answer -- "No news to show right now" --
 * which tells the reader something false (#321). Missing content is still
 * empty; only a failure gets this.
 */
@Component({
  selector: 'app-load-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="load-error" role="alert">
      <span class="material-symbols-rounded" aria-hidden="true">error</span>
      <span>Couldn't load {{ what() }}. Please try again later.</span>
    </p>
  `,
  styles: `
    .load-error {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
  `,
})
export class LoadErrorComponent {
  /** What failed to load, as it reads after "Couldn't load": "the latest news". */
  readonly what = input.required<string>();
}
