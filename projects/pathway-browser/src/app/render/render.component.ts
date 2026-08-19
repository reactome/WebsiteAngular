import {
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { DiagramComponent } from '../diagram/diagram.component';
import { EhldComponent } from '../ehld/ehld.component';
import { ReacfoamComponent } from '../reacfoam/reacfoam.component';
import { UrlStateService } from '../services/url-state.service';
import { DataStateService } from '../services/data-state.service';
import { EventService } from '../services/event.service';
import { SvgExporterService } from '../reacfoam/svg-exporter.service';
import { defaultDownloadOptions } from '../services/download.service';

/**
 * A chrome-free page whose only job is to draw a pathway and say when it is
 * finished, so something outside the browser can take the result.
 *
 * Server-side rendering of Reactome diagrams is done today by Java libraries
 * that reimplement the drawing, which is why a downloaded PDF looks like the
 * old site. Rendering through this page instead means there is one renderer:
 * whatever the site draws is what the export contains, with no second
 * implementation to drift.
 *
 * The contract with the caller is `data-render-ready` on the host, and
 * `window.__renderState`. It is deliberately a signal rather than something a
 * caller waits a fixed time for -- a diagram fetches its layout, its
 * interactor overlays and its fonts, and how long that takes is not knowable
 * from outside.
 */
@Component({
  selector: 'cr-render',
  standalone: true,
  imports: [DiagramComponent, EhldComponent, ReacfoamComponent],
  templateUrl: './render.component.html',
  styleUrl: './render.component.scss',
  host: {
    '[attr.data-render-ready]': 'ready()',
    '[attr.data-render-error]': 'error() || null',
  },
})
export class RenderComponent {
  private state = inject(UrlStateService);
  private dataState = inject(DataStateService);
  private eventService = inject(EventService);
  private reacfoamExporter = inject(SvgExporterService);

  readonly pathwayId = this.state.pathwayId as WritableSignal<string>;
  readonly loading = this.dataState._currentPathway.isLoading;
  readonly hasEHLD = computed(() => this.dataState.currentPathway()?.hasEHLD === true);

  private readonly diagram = viewChild(DiagramComponent);
  private readonly reacfoam = viewChild(ReacfoamComponent);

  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  /** What was drawn and how much of it, for the caller to sanity-check. */
  private readonly stateForCaller = signal<Record<string, unknown>>({});

  constructor() {
    // The diagram waits on EventService.diagramPathway$ before it will load,
    // and the only thing that ever fed that stream was the viewport. Without
    // this the page draws the diagram's legend and nothing else, which is a
    // convincing-looking canvas with no pathway in it.
    effect(() => {
      const pathway = this.dataState.currentPathway();
      if (pathway) this.eventService.setDiagramPathway(pathway);
    });

    effect(() => {
      // Read what should retrigger the wait, then leave the tracked context:
      // the polling below must not register dependencies of its own.
      const pathway = this.pathwayId();
      // Deliberately not gated on loading. Waiting for loading to finish first
      // means an id whose fetch never settles -- one that does not exist, for
      // instance -- leaves the wait unstarted, so the page neither draws nor
      // reports anything and the caller pays a full timeout to learn nothing.
      // The wait polls, so starting it early costs nothing.
      untracked(() => void this.waitForDrawn(pathway));
    });
  }

  private async waitForDrawn(pathway: string | undefined) {
    try {
      await this.watchUntilDrawn(pathway);
    } catch (failure) {
      // Reading a resource that failed to load throws rather than returning
      // undefined, so a 404 surfaces here rather than through an error signal.
      // Without this the wait died silently and the caller paid a full timeout
      // to learn nothing.
      this.error.set(
        `could not render ${pathway ?? 'the genome-wide view'}: ` +
          ((failure as Error)?.message ?? String(failure))
      );
      this.publish();
    }
  }

  private async watchUntilDrawn(pathway: string | undefined) {
    this.ready.set(false);
    this.error.set(null);

    const started = Date.now();
    const deadline = started + 60_000;
    // An id that does not resolve should not cost a full timeout. The resource's
    // own error signal does not surface a 404 here, so judge it by what can
    // actually be observed: the fetch has settled and there is nothing to draw.
    // Short, because the check only reads the pathway once its fetch has
    // settled: a slow but valid load is still "loading" and never trips it.
    const giveUpOnMissing = started + 3_000;

    while (Date.now() < deadline) {
      const drawn = this.drawn();

      if (
        !drawn &&
        Date.now() > giveUpOnMissing &&
        !this.loading() &&
        !this.dataState.currentPathway() &&
        pathway
      ) {
        this.error.set(`no pathway found for ${pathway}`);
        this.publish();
        return;
      }
      if (drawn) {
        // Fonts change text metrics, so a diagram drawn before they load is
        // not the diagram the site shows.
        await document.fonts.ready;
        // Two frames: one to apply the last change, one to paint it.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        this.stateForCaller.set({ pathway: pathway ?? null, ...drawn });
        this.publish();
        this.ready.set(true);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.error.set(`nothing drawn for ${pathway ?? 'the genome-wide view'} within 60s`);
    this.publish();
  }

  /**
   * Whether something is actually on screen, and what. Each view reports
   * differently: a diagram has a cytoscape instance with elements, an
   * illustration is an inlined svg, and Reacfoam draws to a canvas.
   */
  private drawn(): Record<string, unknown> | null {
    const host = document.querySelector('cr-render');
    if (!host) return null;

    const diagram = this.diagram();
    if (diagram) {
      const instances = diagram.cys?.filter(Boolean) ?? [];
      const elements = instances.reduce((total, cy) => total + cy.elements().length, 0);
      // Both conditions matter. The element count comes from the diagram's own
      // instances, which excludes the legend -- the legend is a separate
      // cytoscape drawn into the same component and it appears first, so any
      // check that accepts "a canvas exists inside cr-diagram" reports ready
      // while the actual pathway is still loading. The canvas check then
      // confirms the renderer has painted, not merely that elements are loaded.
      const canvas = host.querySelector<HTMLCanvasElement>('#cytoscape canvas');
      if (elements > 0 && canvas && canvas.width > 0 && canvas.height > 0) {
        return { view: 'diagram', instances: instances.length, elements };
      }
      return null;
    }

    const svg = host.querySelector('cr-ehld svg');
    if (svg) return { view: 'ehld', nodes: svg.querySelectorAll('*').length };

    const reacfoam = this.reacfoam();
    if (reacfoam) {
      // Gate on the very thing the exporter reads. A canvas exists early, and
      // the tree holds its groups before it has laid them out -- exporting in
      // that window produces a valid SVG with zero width and nothing in it.
      // Geometry only appears once FoamTree's relaxation has run.
      const tree = untracked(reacfoam.foamTree);
      const dataObject = tree?.get('dataObject');
      const geometry = dataObject ? tree.get('geometry', dataObject) : undefined;
      const groups = dataObject?.groups ?? [];
      if (!geometry?.boxWidth || !geometry?.boxHeight) return null;
      return {
        view: 'reacfoam',
        groups: groups.length,
        box: [geometry.boxWidth, geometry.boxHeight],
      };
    }

    return null;
  }

  private publish() {
    const api = window as unknown as Record<string, unknown>;
    api['__renderState'] = {
      ready: this.ready(),
      error: this.error(),
      ...this.stateForCaller(),
    };
    // The caller asks the page for the artefact rather than reaching into
    // cytoscape itself: how a view exports is the view's business, and a
    // caller poking at renderer internals would break the first time they move.
    api['__renderExport'] = {
      svg: () => this.exportSvg(),
      // Reacfoam's exporter is async, so callers await whatever they get back.
      png: (scale = 1) => this.exportPng(scale),
    };
  }

  /** The drawn view as SVG. Reacfoam's path is asynchronous. */
  private exportSvg(): string | Promise<string> {
    const diagram = this.diagram();
    if (diagram) {
      const instances = diagram.cys?.filter(Boolean) ?? [];
      if (!instances.length) throw new Error('no diagram to export');
      // One instance here by construction: this page never opens the
      // comparison view.
      return instances[0].svg({ full: true });
    }

    const svg = document.querySelector('cr-render cr-ehld svg');
    if (svg) return new XMLSerializer().serializeToString(svg);

    // The genome-wide view draws to a canvas via FoamTree, so it has its own
    // exporter rather than going through cytoscape. It matters here because
    // Reacfoam is what replaced the old fireworks view, which is not being
    // reimplemented.
    //
    // That exporter hands back a blob URL rather than markup -- the download
    // button feeds it straight to an anchor -- so read the blob to get the SVG
    // itself, and release it afterwards.
    const reacfoam = this.reacfoam();
    if (reacfoam) {
      return this.reacfoamExporter
        .exportReacfoam(reacfoam, defaultDownloadOptions)
        .then(async (url) => {
          try {
            return await (await fetch(url)).text();
          } finally {
            URL.revokeObjectURL(url);
          }
        });
    }

    throw new Error('nothing on this page can export SVG');
  }

  /** The drawn view as a PNG data URL. */
  private exportPng(scale: number): string {
    const diagram = this.diagram();
    const instances = diagram?.cys?.filter(Boolean) ?? [];
    if (!instances.length) throw new Error('this view cannot export PNG yet');
    return instances[0].png({ full: true, scale, bg: 'transparent' });
  }
}
