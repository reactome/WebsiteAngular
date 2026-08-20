import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import {
  CONTENT_SERVICE,
  RENDER_SERVICE,
  RESTFUL_API,
} from '../../../../../../pathway-browser/src/environments/environment';
import { DatabaseObject } from '../../../../../../pathway-browser/src/app/model/graph/database-object.model';
import {
  isEvent,
  isPathwayWithDiagram,
  isRLE,
} from '../../../../../../pathway-browser/src/app/services/utils';

/** Scale a PNG tier asks the renderer for. The service clamps above 2. */
const PNG_TIERS = [
  { label: 'Low', scale: 0.5 },
  { label: 'Medium', scale: 1 },
  { label: 'High', scale: 2 },
];

@Component({
  selector: 'app-detail-download-bar',
  standalone: true,
  imports: [MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail-download-bar.component.html',
  styleUrl: './detail-download-bar.component.scss',
})
export class DetailDownloadBarComponent {
  obj = input.required<DatabaseObject>();

  /**
   * Where this copy is being rendered.
   *
   * A reaction's downloads belong in the reaction diagram section, beside the
   * figure they produce -- that is how the current site lists them and it is
   * the only place they make sense. Everything else keeps them with the pathway
   * figure. Content projection cannot be wrapped in a `@if`, so both copies are
   * always projected and each decides for itself whether it is the right one.
   */
  placement = input<'default' | 'reaction'>('default');

  protected readonly tiers = PNG_TIERS;

  private isReaction = computed(() => isRLE(this.obj()));

  protected shown = computed(
    () => isEvent(this.obj()) && this.isReaction() === (this.placement() === 'reaction')
  );

  // A figure needs something to draw: a reaction has its own layout, a pathway
  // has a diagram, and a pathway without one has neither.
  protected showFigureExports = computed(
    () => this.isReaction() || isPathwayWithDiagram(this.obj())
  );

  stId = computed(() => this.obj().stId);
  dbId = computed(() => this.obj().dbId);

  sbmlUrl = computed(() => `${CONTENT_SERVICE}/exporter/event/${this.stId()}.sbml`);
  sbgnUrl = computed(() => `${CONTENT_SERVICE}/exporter/event/${this.stId()}.sbgn`);
  biopax2Url = computed(() => `${RESTFUL_API}/biopaxExporter/Level2/${this.dbId()}`);
  biopax3Url = computed(() => `${RESTFUL_API}/biopaxExporter/Level3/${this.dbId()}`);
  pdfUrl = computed(() => `${CONTENT_SERVICE}/exporter/document/event/${this.stId()}.pdf`);

  svgUrl = computed(() => this.figureUrl('svg'));
  pptxUrl = computed(() => this.figureUrl('pptx'));

  pngUrl(scale: number): string {
    return this.figureUrl('png', { scale: String(scale) });
  }

  /**
   * A figure from the render service, which drives the site's own renderer.
   *
   * So a downloaded picture is the picture the page shows. The old exporters
   * reimplement the drawing server side, which is why a download used to come
   * back in the previous site's style; a reaction asks for its own layout,
   * which is what its diagram section displays.
   */
  private figureUrl(format: string, params: Record<string, string> = {}) {
    const url = new URL(
      `${RENDER_SERVICE}/render/${this.stId()}.${format}`,
      window.location.origin
    );
    if (this.isReaction()) url.searchParams.set('view', 'reaction');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }
}
