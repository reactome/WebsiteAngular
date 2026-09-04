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
import type {
  RenderEdgeShape,
  RenderNodeShape,
  RenderShapes,
  ShapeColour,
  ShapeGeometry,
} from './render-shapes.model';

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
        // Set before publishing, not after: publish() copies the signal's value
        // into __renderState, so doing it the other way round left that object
        // permanently reporting ready:false while the DOM attribute the render
        // service waits on said otherwise. Anything trusting the published flag
        // waited forever.
        this.ready.set(true);
        this.publish();
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
      // The diagram as shapes rather than as a picture, for exporters that draw
      // shapes -- PowerPoint. Null where the view is not made of shapes (an
      // illustration, the genome-wide view) and the caller embeds the picture.
      shapes: () => this.exportShapes(),
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
  /**
   * The diagram described as shapes, in diagram coordinates.
   *
   * Reads what cytoscape resolved rather than the stylesheet: a node's fill
   * depends on its type, on whether an analysis is overlaid and on which sample
   * is showing, and only the live style knows the answer.
   *
   * Null for views that are not made of shapes -- an illustration is artwork and
   * the genome-wide view draws to a canvas -- so a caller can fall back to
   * embedding the picture rather than emitting an empty slide.
   */
  private exportShapes(): RenderShapes | null {
    const reaction = this.reaction()?.core();
    const cy = reaction ?? this.exportableInstances().instances[0];
    if (!cy) return null;

    // Mirror exportSvg exactly. A reaction's layout is the whole figure, so
    // there is nothing to frame; a diagram asked for one event is framed on it,
    // and exportSvg then exports the viewport rather than everything. Without
    // this the same request produced a framed SVG and an unframed slide.
    const framed = !reaction && this.frameSelection(cy);
    const extent = framed ? cy.extent() : cy.elements().boundingBox();
    const within = (box: { x1: number; y1: number; x2: number; y2: number }) =>
      !framed ||
      (box.x2 >= extent.x1 && box.x1 <= extent.x2 && box.y2 >= extent.y1 && box.y1 <= extent.y2);

    // Keeping a glyph that merely crosses the frame is right; keeping the parts
    // of it that fall outside is not. An SVG has a viewBox and simply does not
    // draw them, and a slide has nothing of the sort -- a connector that ran the
    // width of the diagram arrived as an object sitting 31 inches off the side
    // of an 11 inch slide, which is what a reader would find when they opened it.
    const clipBox = (box: { x1: number; y1: number; x2: number; y2: number }) =>
      framed
        ? {
            x1: Math.max(box.x1, extent.x1),
            y1: Math.max(box.y1, extent.y1),
            x2: Math.min(box.x2, extent.x2),
            y2: Math.min(box.y2, extent.y2),
          }
        : box;

    // toArray() rather than iterating the collection: a cytoscape collection is
    // array-like without being an array, and its filter hands back the loose
    // element type rather than a node.
    const visible = cy
      .nodes()
      .toArray()
      .filter((node) => node.visible())
      .filter((node) => within(node.boundingBox({ includeLabels: false, includeOverlays: false })));

    const compartments: RenderNodeShape[] = [];
    const nodes: RenderNodeShape[] = [];
    const nodeUnderlays: RenderNodeShape[] = [];
    const edges: RenderEdgeShape[] = [];
    const edgeUnderlays: RenderEdgeShape[] = [];
    const arrowheads: (RenderNodeShape | RenderEdgeShape)[] = [];

    for (const node of visible) {
      const box = clipBox(node.boundingBox({ includeLabels: false, includeOverlays: false }));
      if (box.x2 <= box.x1 || box.y2 <= box.y1) continue;
      const label = String(node.data('displayName') ?? '').trim();
      const under = this.underlay(node);
      if (under) {
        nodeUnderlays.push({
          kind: 'node',
          id: `${node.id()}-underlay`,
          name: `${label || node.id()} highlight`,
          x: Math.max(box.x1 - under.padding, framed ? extent.x1 : -Infinity),
          y: Math.max(box.y1 - under.padding, framed ? extent.y1 : -Infinity),
          w:
            Math.min(box.x2 + under.padding, framed ? extent.x2 : Infinity) -
            Math.max(box.x1 - under.padding, framed ? extent.x1 : -Infinity),
          h:
            Math.min(box.y2 + under.padding, framed ? extent.y2 : Infinity) -
            Math.max(box.y1 - under.padding, framed ? extent.y1 : -Infinity),
          geom: this.geometryOf(String(node.style('shape') ?? '')),
          fill: under.colour,
          stroke: null,
          strokeWidth: 0,
          label: '',
          fontSize: 0,
          fontColor: null,
          bold: false,
          dashed: false,
        });
      }

      (this.isCompartment(node) ? compartments : nodes).push({
        kind: 'node',
        id: String(node.id()),
        name: label || String(node.data('schemaClass') ?? node.id()),
        x: box.x1,
        y: box.y1,
        w: box.x2 - box.x1,
        h: box.y2 - box.y1,
        geom: this.geometryOf(String(node.style('shape') ?? '')),
        fill: this.colour(node.style('background-color'), node.style('background-opacity')),
        stroke: this.colour(node.style('border-color'), node.style('border-opacity')),
        strokeWidth: this.pixels(node.style('border-width')),
        label,
        fontSize: this.pixels(node.style('font-size')) || 8,
        fontColor: this.colour(node.style('color'), '1'),
        bold: String(node.style('font-weight') ?? '').includes('bold'),
        dashed: this.dashed(node.style('border-style')),
      });
    }

    for (const edge of cy
      .edges()
      .toArray()
      .filter((edge) => edge.visible())
      .filter((edge) => within(edge.boundingBox()))) {
      // Bend points are how the diagram's orthogonal routing is stored; without
      // them every connector exports as a straight diagonal.
      const whole = [edge.sourceEndpoint(), ...this.bendPoints(edge), edge.targetEndpoint()].map(
        (point) => ({ x: point.x, y: point.y })
      );
      // Unframed, this is the polyline itself; framed, only the parts in view.
      const runs = framed ? this.clipRuns(whole, extent) : [whole];
      if (!runs.length) continue;
      const points = whole;
      const width = this.pixels(edge.style('width')) || 1;
      const under = this.underlay(edge);
      if (under) {
        // One band per run, or a connector clipped into two pieces keeps its
        // tint on the first and loses it on the rest.
        runs.forEach((run, at) => {
          edgeUnderlays.push({
            kind: 'edge',
            id: at === 0 ? `${edge.id()}-underlay` : `${edge.id()}-underlay-${at}`,
            name: `${String(edge.data('schemaClass') ?? 'connector')} highlight`,
            points: run,
            stroke: under.colour,
            // Cytoscape pads an underlay outwards from the line, so the band is
            // the line plus that padding on each side.
            strokeWidth: width + 2 * under.padding,
            closed: false,
            fill: null,
            dashed: false,
          });
        });
      }

      const stroke = this.colour(edge.style('line-color'), edge.style('opacity'));
      const dashed = this.dashed(edge.style('line-style'));
      runs.forEach((run, at) => {
        edges.push({
          kind: 'edge',
          id: at === 0 ? String(edge.id()) : `${edge.id()}-${at}`,
          name: String(edge.data('schemaClass') ?? 'connector'),
          points: run,
          stroke,
          strokeWidth: width,
          closed: false,
          fill: null,
          dashed,
        });
      });

      // The arrowhead is drawn after its line, so it sits on top of it -- and
      // only when the end it marks is in view.
      const tip = points[points.length - 1];
      const showsTip =
        !framed ||
        (tip.x >= extent.x1 && tip.x <= extent.x2 && tip.y >= extent.y1 && tip.y <= extent.y2);
      if (showsTip) arrowheads.push(...this.arrowhead(edge, points, width));
    }

    return {
      x: extent.x1,
      y: extent.y1,
      width: extent.x2 - extent.x1,
      height: extent.y2 - extent.y1,
      // Draw order, back to front: OOXML paints in document order, a
      // compartment covers everything inside it, and the diagram draws
      // connectors under the entities they join. An exporter can emit this
      // array as it stands without knowing what any of the shapes are.
      //
      // The underlays are how the diagram tints an event by the sub-pathway it
      // belongs to, and each sits immediately behind the glyph it marks -- so
      // they go in front of the compartments and behind everything else.
      shapes: [
        ...compartments,
        ...edgeUnderlays,
        ...edges,
        ...arrowheads,
        ...nodeUnderlays,
        ...nodes,
      ],
    };
  }

  private isCompartment(node: cytoscape.NodeSingular): boolean {
    return /compartment/i.test(
      String(node.data('schemaClass') ?? '') + ' ' + node.classes().join(' ')
    );
  }

  private geometryOf(shape: string): ShapeGeometry {
    if (shape.includes('ellipse')) return 'ellipse';
    if (shape.includes('round')) return 'roundRect';
    return 'rect';
  }

  /** Cytoscape hands numbers back as "12px" as often as 12. */
  private pixels(value: unknown): number {
    const parsed = parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * A style colour as six hex digits, or null where it would not be painted.
   *
   * OOXML's srgbClr carries no alpha, so anything fully transparent becomes "no
   * fill" rather than a colour nobody can see.
   */
  /**
   * A style's colour, with its opacity folded in.
   *
   * The opacity is not a detail: this diagram fills its compartments at 6% and
   * draws 206 of its borders at 14%, so dropping it painted a compartment as a
   * solid orange slab over everything inside it. Fully opaque colours stay six
   * digits, so the common case reads the same as it did.
   */
  private colour(value: unknown, opacity: unknown): ShapeColour {
    const given = String(opacity ?? '');
    const alpha = given === '' ? 1 : this.pixels(given);
    if (alpha <= 0) return null;

    const text = String(value ?? '').trim();
    const withAlpha = (channels: number[], own = 1) => {
      const combined = Math.max(0, Math.min(1, alpha * own));
      if (combined <= 0) return null;
      const hex = channels
        .map((channel) =>
          Math.max(0, Math.min(255, Math.round(channel)))
            .toString(16)
            .padStart(2, '0')
        )
        .join('');
      // Six digits when opaque, eight when not: an exporter that only knows
      // about six still reads the colour right.
      return combined >= 1
        ? hex
        : hex +
            Math.round(combined * 255)
              .toString(16)
              .padStart(2, '0');
    };

    const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
    if (rgb) {
      const parts = rgb[1].split(/[,\s/]+/).map((part) => parseFloat(part));
      if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
        const own = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
        return withAlpha(parts.slice(0, 3), own);
      }
    }
    const hex = /^#?([0-9a-f]{6})$/i.exec(text);
    if (hex) {
      return withAlpha([0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16)));
    }
    const short = /^#?([0-9a-f]{3})$/i.exec(text);
    if (short) {
      return withAlpha([...short[1]].map((digit) => parseInt(digit + digit, 16)));
    }
    return null;
  }

  /**
   * A polyline cut down to a rectangle, as the runs that survive.
   *
   * Liang-Barsky per segment. A connector crossing the frame twice comes back
   * as two runs rather than one line joining them through the middle, which is
   * what naive clipping to the endpoints would draw.
   */
  private clipRuns(
    points: { x: number; y: number }[],
    box: { x1: number; y1: number; x2: number; y2: number }
  ): { x: number; y: number }[][] {
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];

    const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

    for (let at = 0; at < points.length - 1; at++) {
      const from = points[at];
      const to = points[at + 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      let enter = 0;
      let leave = 1;
      let inside = true;

      for (const [p, q] of [
        [-dx, from.x - box.x1],
        [dx, box.x2 - from.x],
        [-dy, from.y - box.y1],
        [dy, box.y2 - from.y],
      ]) {
        if (p === 0) {
          // Parallel to this edge: outside it means the whole segment is out.
          if (q < 0) {
            inside = false;
            break;
          }
          continue;
        }
        const at2 = q / p;
        if (p < 0) enter = Math.max(enter, at2);
        else leave = Math.min(leave, at2);
      }
      if (!inside || enter > leave) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }

      const start = { x: from.x + dx * enter, y: from.y + dy * enter };
      const end = { x: from.x + dx * leave, y: from.y + dy * leave };
      if (!run.length) run.push(start);
      else if (!near(run[run.length - 1], start)) {
        if (run.length > 1) runs.push(run);
        run = [start];
      }
      run.push(end);
      // A segment that left the box ends the run.
      if (leave < 1) {
        runs.push(run);
        run = [];
      }
    }

    if (run.length > 1) runs.push(run);
    return runs;
  }

  /**
   * The mark at the target end of a connector, as geometry.
   *
   * The diagram uses four, and three of them mean something a triangle does
   * not: catalysis is a hollow circle, positive regulation a hollow triangle,
   * and negative regulation a bar across the line. Exporting them all as a
   * filled triangle drew inhibition as activation, which is a figure that says
   * the opposite of what the pathway does.
   *
   * Built here rather than in the exporter because it is diagram geometry --
   * where the line ends, which way it points -- and because OOXML's own line
   * ends cannot express a bar, a hollow head, or a colour of their own.
   */
  private arrowhead(
    edge: cytoscape.EdgeSingular,
    points: { x: number; y: number }[],
    width: number
  ): (RenderNodeShape | RenderEdgeShape)[] {
    const shape = String(edge.style('target-arrow-shape') ?? 'none');
    if (shape === 'none' || points.length < 2) return [];

    const colour = this.colour(edge.style('target-arrow-color'), edge.style('opacity'));
    if (!colour) return [];

    const hollow = String(edge.style('target-arrow-fill') ?? 'filled') === 'hollow';
    // Cytoscape scales an arrow by the line's width; measured against the
    // exported SVG, a 4px connector carries a 16px head.
    const scale = this.pixels(edge.style('arrow-scale')) || 1;
    const size = Math.max(6, width * 4 * scale);

    const tip = points[points.length - 1];
    const from = points[points.length - 2];
    const run = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    // Along the line, and across it.
    const ax = (tip.x - from.x) / run;
    const ay = (tip.y - from.y) / run;
    const cx = -ay;
    const cy = ax;

    const name = `${String(edge.data('schemaClass') ?? 'connector')} ${shape}`;
    const id = `${edge.id()}-arrow`;

    if (shape === 'tee') {
      // A bar across the line's end. Its thickness is the line's, not the
      // head's, or inhibition on a hairline connector becomes a black square.
      return [
        {
          kind: 'edge',
          id,
          name,
          points: [
            { x: tip.x + cx * (size / 2), y: tip.y + cy * (size / 2) },
            { x: tip.x - cx * (size / 2), y: tip.y - cy * (size / 2) },
          ],
          stroke: colour,
          strokeWidth: Math.max(width, size / 4),
          closed: false,
          fill: null,
          dashed: false,
        },
      ];
    }

    if (shape === 'circle') {
      // Centred where the line stops, which is how cytoscape seats it.
      return [
        {
          kind: 'node',
          id,
          name,
          x: tip.x - ax * (size / 2) - size / 2,
          y: tip.y - ay * (size / 2) - size / 2,
          w: size,
          h: size,
          geom: 'ellipse',
          fill: hollow ? null : colour,
          stroke: colour,
          strokeWidth: hollow ? Math.max(1, width) : 0,
          label: '',
          fontSize: 0,
          fontColor: null,
          bold: false,
          dashed: false,
        },
      ];
    }

    // Everything else is a triangle: the tip on the line's end, the base back
    // along it. `stealth`, `diamond` and the rest do not occur in this diagram,
    // and a triangle is the honest approximation if one ever does.
    const base = { x: tip.x - ax * size, y: tip.y - ay * size };
    return [
      {
        kind: 'edge',
        id,
        name,
        points: [
          { x: tip.x, y: tip.y },
          { x: base.x + cx * (size / 2), y: base.y + cy * (size / 2) },
          { x: base.x - cx * (size / 2), y: base.y - cy * (size / 2) },
        ],
        stroke: colour,
        strokeWidth: hollow ? Math.max(1, width) : 0,
        closed: true,
        fill: hollow ? null : colour,
        dashed: false,
      },
    ];
  }

  /**
   * The band the diagram draws behind a glyph, if it draws one.
   *
   * This is how a pathway shows which sub-pathway an event belongs to: the
   * style puts a thick, semi-transparent underlay in the sub-pathway's colour
   * behind the event's glyph and its connectors. It is not the glyph's own
   * colour, so reading `line-color` alone lost every tint -- this diagram draws
   * 216 of them, and they are the most visible thing on it after the glyphs.
   */
  private underlay(element: cytoscape.NodeSingular | cytoscape.EdgeSingular): {
    colour: ShapeColour;
    padding: number;
  } | null {
    const colour = this.colour(element.style('underlay-color'), element.style('underlay-opacity'));
    if (!colour) return null;
    return { colour, padding: Math.max(0, this.pixels(element.style('underlay-padding'))) };
  }

  /** Whether a style draws a broken line; the diagram uses one dash pattern. */
  private dashed(value: unknown): boolean {
    return /dash|dot/i.test(String(value ?? ''));
  }

  /** Whatever bend points an edge carries, in whichever form it stores them. */
  private bendPoints(edge: cytoscape.EdgeSingular): { x: number; y: number }[] {
    const candidate = edge as unknown as {
      segmentPoints?: () => { x: number; y: number }[];
      controlPoints?: () => { x: number; y: number }[];
    };
    const points = candidate.segmentPoints?.() ?? candidate.controlPoints?.() ?? [];
    return Array.isArray(points) ? points.filter((point) => Number.isFinite(point?.x)) : [];
  }

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
