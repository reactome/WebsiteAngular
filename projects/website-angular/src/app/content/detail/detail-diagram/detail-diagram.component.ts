import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  CONTENT_SERVICE,
  environment,
} from '../../../../../../pathway-browser/src/environments/environment';
import { DatabaseObject } from '../../../../../../pathway-browser/src/app/model/graph/database-object.model';

// Pathway-only fields the data layer doesn't expose on the base
// DatabaseObject type. The /content/detail page only renders this
// component for entities that the JSON has these fields on (top-level
// pathways carry hasEHLD + figure[]; sub-pathways carry hasDiagram).
interface PathwayFigure {
  url: string;
  displayName: string;
}

interface PathwayLike extends DatabaseObject {
  hasEHLD?: boolean;
  hasDiagram?: boolean;
  figure?: PathwayFigure[];
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

  private pathway = computed<PathwayLike>(() => this.obj() as PathwayLike);

  // Top-level pathways have a curated EHLD .svg referenced by their
  // `figure` array; we render that directly. Description-tab filters
  // these out (the PathwayBrowser shows them elsewhere) but the
  // /content/detail page doesn't embed the browser, so nothing else
  // surfaces the diagram here.
  ehldUrl = computed<string | null>(() => {
    const p = this.pathway();
    if (!p?.hasEHLD || !p.figure?.length) return null;
    const ehld = p.figure.find(f => f.url?.includes('ehld'));
    return ehld ? `${environment.host}${ehld.url}` : null;
  });

  // Sub-pathways and reactions without an EHLD fall back to the
  // ContentService diagram exporter which renders the layout PNG.
  diagramUrl = computed<string | null>(() => {
    const p = this.pathway();
    if (!p?.stId || !p.hasDiagram || p.hasEHLD) return null;
    return `${CONTENT_SERVICE}/exporter/diagram/${p.stId}.png?quality=7`;
  });

  alt = computed(() => `${this.obj().displayName} diagram`);
}
