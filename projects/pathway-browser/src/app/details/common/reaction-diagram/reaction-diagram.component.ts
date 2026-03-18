import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  input,
  OnDestroy,
  viewChild
} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Style} from 'reactome-cytoscape-style';
import cytoscape from 'cytoscape';
import {Diagram} from '../../../model/diagram.model';
import {Graph} from '../../../model/graph.model';
import {DiagramService} from '../../../services/diagram.service';
import {CONTENT_SERVICE} from '../../../../environments/environment';

interface ReactionJson {
  diagram: Diagram;
  graph: Graph.Data;
}

@Component({
  selector: 'cr-reaction-diagram',
  templateUrl: './reaction-diagram.component.html',
  styleUrl: './reaction-diagram.component.scss',
})
export class ReactionDiagramComponent implements AfterViewInit, OnDestroy {
  private http = inject(HttpClient);
  private diagramService = inject(DiagramService);

  readonly stId = input.required<string>();

  private containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private cy?: cytoscape.Core;
  private reactomeStyle?: Style;

  ngAfterViewInit() {
    const container = this.containerRef().nativeElement;
    this.reactomeStyle = new Style(container);

    this.http.get<ReactionJson>(`${CONTENT_SERVICE}/exporter/reaction/${this.stId()}/diagram`)
      .subscribe(({diagram, graph}) => {
        // Ensure required arrays exist (reaction diagrams may omit empty arrays)
        diagram.links = diagram.links || [];
        diagram.shadows = diagram.shadows || [];
        diagram.compartments = diagram.compartments || [];
        graph.subpathways = graph.subpathways || [];

        const elements = this.diagramService.diagramFromData(diagram, graph);

        this.cy = cytoscape({
          container,
          elements,
          style: this.reactomeStyle?.getStyleSheet(),
          layout: {name: 'preset'},
          boxSelectionEnabled: false,
        });

        this.reactomeStyle?.bindToCytoscape(this.cy);
        this.cy.fit(undefined, 20);
        this.cy.userZoomingEnabled(true);
        this.cy.userPanningEnabled(true);
        this.cy.autoungrabify(true);
      });
  }

  ngOnDestroy() {
    this.cy?.destroy();
  }
}
