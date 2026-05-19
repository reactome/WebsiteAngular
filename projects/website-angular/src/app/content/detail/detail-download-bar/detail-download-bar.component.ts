import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import {
  CONTENT_SERVICE,
  RESTFUL_API,
} from '../../../../../../pathway-browser/src/environments/environment';
import { DatabaseObject } from '../../../../../../pathway-browser/src/app/model/graph/database-object.model';
import { isEvent, isPathway } from '../../../../../../pathway-browser/src/app/services/utils';

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

  // SBML/BioPAX/PDF are event-level exports; diagram-only formats
  // (SVG, PNG, PPTX, SBGN) are pathway-only because they target the
  // entity's own diagram.
  showEventExports = computed(() => isEvent(this.obj()));
  showDiagramExports = computed(() => isPathway(this.obj()));

  stId = computed(() => this.obj().stId);
  dbId = computed(() => this.obj().dbId);

  sbmlUrl = computed(() => `${CONTENT_SERVICE}/exporter/event/${this.stId()}.sbml`);
  sbgnUrl = computed(() => `${CONTENT_SERVICE}/exporter/event/${this.stId()}.sbgn`);
  biopax2Url = computed(() => `${RESTFUL_API}/biopaxExporter/Level2/${this.dbId()}`);
  biopax3Url = computed(() => `${RESTFUL_API}/biopaxExporter/Level3/${this.dbId()}`);
  pdfUrl = computed(() => `${CONTENT_SERVICE}/exporter/document/event/${this.stId()}.pdf`);
  svgUrl = computed(() => `${CONTENT_SERVICE}/exporter/diagram/${this.stId()}.svg`);
  pptxUrl = computed(() => `${CONTENT_SERVICE}/exporter/diagram/${this.stId()}.pptx`);
  pngUrl(quality: number): string {
    return `${CONTENT_SERVICE}/exporter/diagram/${this.stId()}.png?quality=${quality}`;
  }
}
