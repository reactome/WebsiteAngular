import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One header for every page (proposal, UI review of 23 Nov 2026): the section
 * it belongs to, its title, and a line saying what it is for. Thirteen pages
 * each styled their own header, so the site opened differently page by page.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      @if (section()) {
        <p class="section">{{ section() }}</p>
      }
      <h1>{{ title() }}</h1>
      @if (description()) {
        <p class="description">{{ description() }}</p>
      }
      <ng-content />
    </header>
  `,
  styles: `
    .page-header {
      display: grid;
      gap: 8px;
      padding-bottom: 20px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--outline-variant);
      text-align: start;
    }
    .section {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--primary);
    }
    h1 {
      margin: 0;
      font-size: clamp(26px, 3vw, 34px);
      font-weight: 700;
      line-height: 1.2;
      color: var(--on-surface);
      text-wrap: balance;
    }
    /* Its own description, and the one a page passes in with links in it */
    .description,
    .page-header ::ng-deep .description {
      margin: 0;
      max-width: 65ch;
      font-size: 17px;
      line-height: 1.5;
      color: var(--on-surface-variant);
    }
    .page-header ::ng-deep .description a {
      color: var(--primary);
      text-decoration: underline;
    }
  `,
})
export class PageHeaderComponent {
  readonly section = input<string>('');
  readonly title = input.required<string>();
  readonly description = input<string>('');
}
