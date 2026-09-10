import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  CONTENT_SERVICE,
  RENDER_SERVICE,
} from '../../../../../../pathway-browser/src/environments/environment';
import { DatabaseObject } from '../../../../../../pathway-browser/src/app/model/graph/database-object.model';

interface PathwayLike extends DatabaseObject {
  hasDiagram?: boolean;
}

@Component({
  selector: 'app-detail-diagram',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail-diagram.component.html',
  styleUrl: './detail-diagram.component.scss',
})
export class DetailDiagramComponent {
  obj = input.required<DatabaseObject>();

  /**
   * The pathway's own figure, drawn by the site's renderer.
   *
   * This used to come from the content service's diagram exporter, which
   * reimplements the drawing server side -- so the picture on the page was the
   * previous site's style while the download buttons beside it, which go through
   * the render service, were the new one. Two different pictures of the same
   * pathway on one page is the sort of thing a curator files as a bug, so they
   * are the same renderer now.
   *
   * SVG rather than PNG: it is a vector either way, it scales for the reader, and
   * the exporter's PNG endpoint used to 500 on top-level pathways that have an
   * illustration.
   */
  diagramUrl = computed<string | null>(() => {
    const p = this.obj() as PathwayLike;
    if (!p?.stId || !p.hasDiagram) return null;
    return `${RENDER_SERVICE}/render/${p.stId}.svg`;
  });

  /**
   * Where the picture comes from when the renderer cannot answer.
   *
   * A cold render takes seconds and a service can be down; the old exporter is
   * still there and still draws something for every pathway. Falling back keeps
   * the page useful rather than blank -- and once, not repeatedly, because the
   * fallback failing would fire error again.
   */
  fallback(event: Event) {
    const image = event.target as HTMLImageElement;
    const stId = (this.obj() as PathwayLike).stId;
    const exporter = `${CONTENT_SERVICE}/exporter/diagram/${stId}.svg`;
    if (image.src === exporter) return;
    image.src = exporter;
  }

  alt = computed(() => `${this.obj().displayName} diagram`);
}
