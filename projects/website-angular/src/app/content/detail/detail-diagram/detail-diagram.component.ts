import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CONTENT_SERVICE } from '../../../../../../pathway-browser/src/environments/environment';
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

  // The ContentService diagram-exporter SVG endpoint returns whichever
  // is appropriate per pathway: the curated EHLD .svg when one exists,
  // the auto-rendered layout SVG otherwise. We use SVG (not PNG)
  // because the PNG endpoint 500s for EHLD-bearing top-level pathways,
  // and because /figures/ehld/* sits behind SSO on the dev host.
  diagramUrl = computed<string | null>(() => {
    const p = this.obj() as PathwayLike;
    if (!p?.stId || !p.hasDiagram) return null;
    return `${CONTENT_SERVICE}/exporter/diagram/${p.stId}.svg`;
  });

  alt = computed(() => `${this.obj().displayName} diagram`);
}
