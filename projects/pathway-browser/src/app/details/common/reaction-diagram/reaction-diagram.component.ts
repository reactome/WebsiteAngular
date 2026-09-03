import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Style } from 'reactome-cytoscape-style';
import cytoscape from 'cytoscape';
import { Diagram } from '../../../model/diagram.model';
import { Graph } from '../../../model/graph.model';
import { DiagramService } from '../../../services/diagram.service';
import { CONTENT_SERVICE } from '../../../../environments/environment';

/** Space left around the reaction, in pixels of the container. */
const PADDING = 20;

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
  private resizeObserver?: ResizeObserver;

  /**
   * What was drawn, for anything that needs to export this figure rather than
   * look at it -- the render page, which serves the reaction page's downloads.
   * A download of a reaction should be the picture the reaction page shows, and
   * that is this instance: the reaction's own layout, not the pathway diagram it
   * came from framed on one node.
   */
  private readonly drawn = signal<cytoscape.Core | undefined>(undefined);
  readonly core = this.drawn.asReadonly();

  /** The reaction's name, for a caller that has to caption the figure. */
  readonly figureName = signal('');

  ngAfterViewInit() {
    const container = this.containerRef().nativeElement;
    this.reactomeStyle = new Style(container);

    this.http
      .get<ReactionJson>(`${CONTENT_SERVICE}/exporter/reaction/${this.stId()}/diagram`)
      .subscribe(({ diagram, graph }) => {
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
          layout: { name: 'preset' },
          boxSelectionEnabled: false,
        });

        this.reactomeStyle?.bindToCytoscape(this.cy);
        this.figureName.set(diagram.displayName ?? '');
        this.drawn.set(this.cy);
        this.cy.userZoomingEnabled(true);
        this.cy.userPanningEnabled(true);
        this.cy.autoungrabify(true);

        this.frame();
        // Labels decide how wide a node is, so a fit before the fonts arrive is
        // a fit to the wrong diagram.
        void document.fonts.ready.then(() => this.frame());
        this.watchForResize(container);
      });
  }

  /**
   * Put the whole reaction inside the viewport.
   *
   * PADDING has to clear the compartment's border, which cytoscape draws centred
   * on the node's outline: half of it falls outside the box `fit` measures.
   */
  private frame() {
    if (!this.cy) return;
    this.cy.resize();
    this.cy.fit(undefined, PADDING);
  }

  /**
   * Re-fit when the container changes width.
   *
   * cytoscape resizes its canvas with the element but keeps the pan and zoom it
   * had, so a container that narrows after the first fit leaves the diagram
   * hanging over the edge -- which is what cut the compartment's right border
   * off on the reaction page: this draws before the page's sidebar and toolbar
   * have settled, and the width it fitted to was not the width it ended up with.
   */
  private watchForResize(container: HTMLElement) {
    let pending = 0;
    this.resizeObserver = new ResizeObserver(() => {
      // Coalesced: an observer that re-fits per callback fights a smooth window
      // drag, and fitting inside the callback can trigger another one.
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.frame());
    });
    this.resizeObserver.observe(container);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.drawn.set(undefined);
    this.cy?.destroy();
  }
}
