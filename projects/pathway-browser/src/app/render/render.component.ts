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
import { ReactionDiagramComponent } from '../details/common/reaction-diagram/reaction-diagram.component';
import { UrlStateService } from '../services/url-state.service';
import { DataStateService } from '../services/data-state.service';
import { EventService } from '../services/event.service';
import { ActivatedRoute } from '@angular/router';
import { SvgExporterService } from '../reacfoam/svg-exporter.service';
import { AnalysisService } from '../services/analysis.service';
import { EhldService } from '../services/ehld.service';
import { DarkService } from '../services/dark.service';
import type cytoscape from 'cytoscape';
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
  imports: [DiagramComponent, EhldComponent, ReacfoamComponent, ReactionDiagramComponent],
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
  private analysis = inject(AnalysisService);
  private ehldService = inject(EhldService);
  private dark = inject(DarkService);
  private route = inject(ActivatedRoute);

  /**
   * ?subpathways=false leaves the sub-pathway tints and labels out, matching
   * the checkbox in the download panel. A report wants this set once for every
   * figure it generates rather than per download.
   */
  private readonly wantsSubpathways =
    this.route.snapshot.queryParamMap.get('subpathways') !== 'false';

  /**
   * ?dark=true renders the dark theme. Light otherwise -- and explicitly so.
   *
   * The theme is not just the chrome: the diagram has its own dark palette, and
   * DarkService picks a default from localStorage or, failing that, from the
   * browser's prefers-color-scheme. Neither belongs anywhere near a figure. A
   * renderer whose output depends on the machine it runs on is a renderer whose
   * cache is lying, and "the exports changed colour and nobody touched
   * anything" is a bad afternoon.
   */
  private readonly wantsDark = this.route.snapshot.queryParamMap.get('dark') === 'true';

  /**
   * ?select=<stId> frames the figure on one event rather than the whole diagram.
   *
   * This is what a reaction page needs. Reactome's own reaction exporter draws a
   * standalone figure by laying the reaction out afresh -- inputs, outputs,
   * catalysts, arranged by its own algorithm -- which is a second layout to
   * maintain and does not look like the diagram the curator drew. Framing the
   * curated diagram on that reaction instead gives the same subject in the
   * layout it actually has, and needs no new drawing code at all.
   */
  private readonly selection = this.route.snapshot.queryParamMap.get('select') ?? '';

  /**
   * ?view=reaction draws the reaction's own layout instead of the pathway
   * diagram, which is what the reaction page shows and therefore what its
   * downloads have to contain. `select` frames the curated diagram on an event
   * and is the right answer for a figure that wants the surrounding context;
   * this is the right answer for a figure that has to match a page.
   */
  private readonly reactionView = this.route.snapshot.queryParamMap.get('view') === 'reaction';

  readonly pathwayId = this.state.pathwayId as WritableSignal<string>;
  readonly loading = this.dataState._currentPathway.isLoading;
  readonly hasEHLD = computed(() => this.dataState.currentPathway()?.hasEHLD === true);

  private readonly diagram = viewChild(DiagramComponent);
  private readonly reacfoam = viewChild(ReacfoamComponent);
  private readonly reaction = viewChild(ReactionDiagramComponent);

  /** Non-empty only in the reaction view, which is what the template keys on. */
  readonly reactionId = computed(() => (this.reactionView ? (this.pathwayId() ?? '') : ''));

  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  /** What was drawn and how much of it, for the caller to sanity-check. */
  private readonly stateForCaller = signal<Record<string, unknown>>({});

  constructor() {
    this.dark.isDark.set(this.wantsDark);

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
        pathway &&
        // A reaction is not a pathway, so currentPathway is empty for the whole
        // of this view's life. Without this the reaction view failed after three
        // seconds while its own fetch was still in flight.
        !this.reactionView
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
        this.stateForCaller.set({
          pathway: pathway ?? null,
          // For a caller that puts the figure in a document and needs to label
          // it. An stId is not a caption.
          name:
            this.dataState.currentPathway()?.displayName || this.reaction()?.figureName() || null,
          ...drawn,
        });
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

    const reaction = this.reaction();
    if (reaction) {
      const cy = reaction.core();
      const canvas = host.querySelector<HTMLCanvasElement>('cr-reaction-diagram canvas');
      const elements = cy?.elements().length ?? 0;
      if (elements > 0 && canvas && canvas.width > 0 && canvas.height > 0) {
        return { view: 'reaction', instances: 1, elements };
      }
      return null;
    }

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
        return {
          view: 'diagram',
          instances: instances.length,
          elements,
          subpathways: this.wantsSubpathways,
        };
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
      // Animation primitives rather than an animation. What an animated format
      // needs is a way to choose a sample and a way to grab what is on screen;
      // deciding frame order, palette and timing is the caller's business, and
      // it differs per format.
      samples: () => this.analysis.samples(),
      showSample: (name: string) => this.showSample(name),
      frameCanvas: (scale = 1) => this.frameCanvas(scale),
    };
  }

  /**
   * Point the viewport at the selected event, so an export of the viewport is a
   * figure of that event.
   *
   * Returns whether it worked: an id that is not in this diagram should fall back
   * to the whole thing rather than exporting an empty frame.
   */
  private frameSelection(cy: cytoscape.Core) {
    if (!this.selection) return false;

    const diagram = this.diagram();
    if (!diagram) return false;

    // The diagram's own lookup, so this matches what selecting in the app does --
    // including pulling in the containers a reference entity appears in.
    const selected = diagram.select(this.selection, cy);
    if (!selected.length) return false;

    // The reaction plus what it connects to: a reaction on its own is a node with
    // no inputs or outputs visible, which is not a figure of anything.
    const withNeighbours =
      'connectedNodes' in selected ? selected.add(selected.connectedNodes()) : selected;

    // No animation: this runs once, immediately before the export.
    cy.fit(withNeighbours, 60);
    return true;
  }

  /** The diagram's cytoscape instances, with the sub-pathway preference applied. */
  private exportableInstances() {
    const diagram = this.diagram();
    const instances = diagram?.cys?.filter(Boolean) ?? [];
    // Applied here rather than while waiting: drawing continues after the
    // diagram first has elements, and anything hidden earlier comes back. The
    // page is disposable, so nothing needs restoring.
    if (diagram && !this.wantsSubpathways) {
      instances.forEach((cy) => diagram.setSubPathwayVisibility(false, cy));
    }
    return { diagram, instances };
  }

  /**
   * Colour the diagram by one sample of an expression analysis, and wait until
   * that is on screen.
   *
   * Setting the signal is not enough to capture from: the recolour happens in an
   * effect and the paint happens after it, so a frame grabbed immediately is the
   * previous sample's. Two frames -- one to apply, one to paint -- is the same
   * wait the readiness check uses.
   */
  private async showSample(name: string) {
    this.state.sample.set(name);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  /**
   * What is on screen, on a canvas, for a caller that needs pixels rather than a
   * file. Frames stay inside the browser: an animation is tens of megabytes of
   * pixel data, and sending each frame out to be assembled costs more than
   * assembling it here.
   */
  private async frameCanvas(scale: number): Promise<HTMLCanvasElement> {
    const { diagram, instances } = this.exportableInstances();
    if (diagram && instances.length) {
      // White, not transparent. Every animated format in play here either has no
      // alpha channel or only a single transparent index, so a transparent
      // background composites to black rather than to nothing.
      return diagram.exportCanvas(instances[0], { full: true, scale, bg: '#ffffff' });
    }

    // An illustration is inline SVG rather than a canvas, so a frame has to be
    // rasterised. That belongs to the illustration's own service, which knows
    // that its styling comes from the page's stylesheets and has to be inlined
    // before the markup means anything on its own.
    const svg = document.querySelector<SVGSVGElement>('cr-render cr-ehld svg');
    if (svg) {
      return await this.ehldService.rasterise(svg, scale, this.wantsDark ? '#0d1617' : '#ffffff');
    }

    throw new Error(
      this.reacfoam()
        ? 'the genome-wide view has no frame capture; render it as svg or png'
        : 'this view has no frames to capture'
    );
  }

  /** The drawn view as SVG. Reacfoam's path is asynchronous. */
  private exportSvg(): string | Promise<string> {
    // full:true either way: the reaction's layout is the figure, so there is
    // nothing to frame and nothing outside it to leave out.
    const reaction = this.reaction()?.core();
    if (reaction) return reaction.svg({ full: true });

    if (this.diagram()) {
      const { instances } = this.exportableInstances();
      if (!instances.length) throw new Error('no diagram to export');
      // One instance here by construction: this page never opens the
      // comparison view.
      //
      // full:false exports what the viewport shows, which is the point when the
      // viewport has been framed on one event.
      const framed = this.frameSelection(instances[0]);
      return instances[0].svg({ full: !framed });
    }

    // Through the illustration's own service, which knows that its styling has
    // to be inlined and its size written down before the markup stands alone.
    const svg = document.querySelector<SVGSVGElement>('cr-render cr-ehld svg');
    if (svg) return this.ehldService.svgMarkup(svg).markup;

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

  /** The colour the diagram draws itself on, whichever theme is active. */
  private diagramBackground(cy: cytoscape.Core) {
    const container = cy.container();
    const background = container ? getComputedStyle(container).backgroundColor : '';
    // A container with no background of its own would give "rgba(0, 0, 0, 0)",
    // which is the transparency this exists to avoid.
    return background && !background.startsWith('rgba(0, 0, 0, 0') ? background : '#ffffff';
  }

  /** The drawn view as a PNG data URL. */
  private async exportPng(scale: number): Promise<string> {
    const reaction = this.reaction()?.core();
    if (reaction) return reaction.png({ full: true, scale, bg: 'transparent' });

    const { instances } = this.exportableInstances();
    if (instances.length) {
      const framed = this.frameSelection(instances[0]);
      return instances[0].png({ full: !framed, scale, bg: 'transparent' });
    }

    // An illustration has no cytoscape instance to ask, so it goes through the
    // same rasteriser the animation frames use. Without this a .png of any
    // illustrated pathway was a 500 -- and illustrations are the top-level
    // pathways, so it was the ones a report is most likely to want.
    const svg = document.querySelector<SVGSVGElement>('cr-render cr-ehld svg');
    if (svg) {
      // No background: a PNG has an alpha channel, and a figure that can sit on
      // any page is more useful than one with a colour baked in.
      const canvas = await this.ehldService.rasterise(svg, scale);
      return canvas.toDataURL('image/png');
    }

    throw new Error('this view cannot export PNG yet');
  }
}
