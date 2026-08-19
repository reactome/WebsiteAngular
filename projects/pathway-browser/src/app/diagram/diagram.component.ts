import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  model,
  OnDestroy,
  Output,
  signal,
  viewChild,
  ViewChild,
  inject,
  HostListener,
} from '@angular/core';
import { DiagramService } from '../services/diagram.service';
import {
  extract,
  interactivityOf,
  ReactomeEvent,
  ReactomeEventTypes,
  Style,
} from 'reactome-cytoscape-style';
import cytoscape, { BoundingBox12, BoundingBoxWH, ElementsDefinition } from 'cytoscape';
import { InteractorService } from '../interactors/services/interactor.service';
import {
  catchError,
  delay,
  distinctUntilChanged,
  EMPTY,
  filter,
  forkJoin,
  map,
  Observable,
  of,
  share,
  Subject,
  switchMap,
  take,
  tap,
} from 'rxjs';
import { UrlStateService } from '../services/url-state.service';
import { UntilDestroy } from '@ngneat/until-destroy';
import { AnalysisService } from '../services/analysis.service';
import { Graph } from '../model/graph.model';
import { average, isDefined, isPathwayWithDiagram, isReferenceEntityStId } from '../services/utils';
import type { Analysis } from '../model/analysis.model';
import { ActivatedRoute, Router } from '@angular/router';
import { InteractorsComponent } from '../interactors/interactors.component';
import { EventService } from '../services/event.service';
import { Event as EventModel } from '../model/graph/event/event.model';

import { DarkService } from '../services/dark.service';
import { DownloadFormat, DownloadService, includeSubpathways } from '../services/download.service';
import { DataStateService } from '../services/data-state.service';
import { SchemaClasses } from '../constants/constants';
import { Interactor } from '../interactors/model/interactor.model';
import { Point, CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { AnalysisLegendComponent } from '../legend/analysis-legend/analysis-legend.component';
import {
  EntityPopupComponent,
  EntityPopupTab,
  EntityPopupTarget,
} from './entity-popup/entity-popup.component';
import { IS_CURATOR } from '../../environments/environment';
import { FlagBannerComponent } from './flag-banner/flag-banner.component';

const INIT_RX = 2;

const END_RX = 0;

const FIT_PADDING = 100;

@UntilDestroy({ checkProperties: true })
@Component({
  selector: 'cr-diagram',
  templateUrl: './diagram.component.html',
  styleUrls: ['./diagram.component.scss'],
  standalone: true,
  imports: [
    CdkDrag,
    CdkDragHandle,
    MatSlider,
    MatSliderThumb,
    MatTooltip,
    FlagBannerComponent,
    AnalysisLegendComponent,
    EntityPopupComponent,
  ],
})
export class DiagramComponent implements AfterViewInit, OnDestroy {
  // The curator build is a tool, not the public site: several panels are
  // hidden there. Gated rather than commented out, which is how they went
  // missing from the public site in the first place.
  readonly isCurator = IS_CURATOR;

  private diagram = inject(DiagramService);
  dark = inject(DarkService);
  private interactorsService = inject(InteractorService);
  protected state = inject(UrlStateService);
  analysis = inject(AnalysisService);
  private event = inject(EventService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private download = inject(DownloadService);
  private data = inject(DataStateService);

  title = 'pathway-browser';
  @ViewChild('cytoscape') cytoscapeContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('cytoscapeCompare') compareContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('legend') legendContainer?: ElementRef<HTMLDivElement>;
  readonly thumbnailRef = viewChild<ElementRef<HTMLImageElement>>('thumbnail');

  readonly interactorsComponent = input<InteractorsComponent>(undefined, {
    alias: 'interactor',
  });
  readonly pathwayId = model.required<string>();

  /** The entity a right-click landed on, or null when no popup is open. */
  readonly popupTarget = signal<EntityPopupTarget | null>(null);

  /**
   * The viewport as it was when the popup opened.
   *
   * Clicking a molecule flies the diagram to it, so going back has to mean
   * "the view I was looking at", not "fit to the entity" -- the latter lands
   * you at a zoom you were never at, which is its own kind of lost.
   */
  private popupViewport: { zoom: number; pan: cytoscape.Position } | null = null;

  readonly controlZoom = signal<number>(0);
  readonly controlMinZoom = signal<number>(1);
  readonly controlMaxZoom = signal<number>(100);

  readonly controlRange = computed(() => this.controlMaxZoom() - this.controlMinZoom());

  comparing: boolean = false;
  isInitialLoad: boolean = true;

  constructor() {
    this.isInitialLoad = Boolean(!this.router.getCurrentNavigation()?.previousNavigation);
    effect(() => this.pathwayId() && this.loadDiagram());
    effect(
      () => {
        const flag = this.data.flagIdentifiers();
        if (!this.data.flagResource.isLoading())
          this.avoidSideEffect(() =>
            this.cys.forEach((cy) => this.flag(this.data.flagIdentifiers(), cy))
          );
        // this.flagging = false;
      },
      { debugName: 'diagram flagging' }
    );
    effect(
      () => {
        if (this.state.select() && !this.selecting)
          this.avoidSideEffect(() =>
            this.cys.forEach((cy) => this.select(this.state.select()!, cy))
          );
        this.selecting = false;
      },
      { debugName: 'diagram selecting' }
    );
    effect(() => {
      const result = this.state.analysis(); // Not in one line to make sure to trigger the update
      this.avoidSideEffect(() => this.loadAnalysis(result));
    });
    effect(
      () =>
        this.analysis.palette() &&
        this.reactomeStyle?.loadAnalysis(this.cy, this.analysis.palette().scale)
    );
    effect(
      () =>
        this.analysis.sampleIndex() !== undefined &&
        this._loadAnalysisFn &&
        this._loadAnalysisFn(this.analysis.sampleIndex())
    );
    effect(() => {
      // Update style upon dark change
      this.dark.isDark();
      this.updateStyle();
    });

    effect(() => {
      const request = this.download.downloadRequest();
      if (request) {
        // Nothing here awaits, so the effect never needed to be async. The
        // export runs on its own and reports its own failure.
        void this.export(request.format).catch((error) =>
          console.error('Diagram export failed', request.format, error)
        );
        this.download.resetDownload();
      }
    });
  }

  async export(format: string) {
    // The sub-pathway tints and labels are navigational aids, and in a figure
    // they compete with the biology. Hidden for the duration of the export and
    // put back afterwards, rather than exported and cropped out later.
    const hideSubpathways = !includeSubpathways();
    if (hideSubpathways) {
      this.cys.filter(Boolean).forEach((cy) => this.setSubPathwayVisibility(false, cy));
    }
    try {
      await this.exportRaster(format);
    } finally {
      if (hideSubpathways) {
        // Back to what the view called for, which is not always "visible": with
        // a flag active the diagram deliberately hides them.
        const flagged = this.state.flag().length > 0;
        this.cys.filter(Boolean).forEach((cy) => this.setSubPathwayVisibility(!flagged, cy));
      }
    }
  }

  private async exportRaster(format: string) {
    if (format === DownloadFormat.SVG) {
      this.exportSvg();
      return;
    }

    const isJpeg = format === DownloadFormat.JPEG;
    const options: cytoscape.ExportJpgBlobPromiseOptions = {
      full: true,
      ...(isJpeg ? { quality: 0.9 } : {}),
      // JPEG has no alpha channel, so a transparent background composites to
      // black rather than to nothing. PNG keeps the transparency.
      bg: isJpeg ? '#ffffff' : 'transparent',
      output: 'blob-promise',
    };

    const blobs = this.cys.map((cy) =>
      format === DownloadFormat.PNG ? cy.png(options) : this.jpegBlob(cy, options)
    );
    let blob: Blob;
    if (blobs.length > 1) {
      const images = await Promise.all(blobs.map((blob) => blob.then(createImageBitmap)));
      const bbs = this.cys.map((cy) => cy.elements().boundingBox({ includeLabels: false }));
      const bgColors = this.cys.map((cy) => getComputedStyle(cy.container()!).backgroundColor);
      blob = await this.mergeImages(
        images,
        bbs,
        bgColors,
        format === DownloadFormat.JPEG ? 'image/jpeg' : 'image/png',
        options?.quality
      );
    } else {
      blob = await blobs[0];
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.pathwayId()}.${format}`;
    a.click();
    a.remove();
  }

  /**
   * The whole diagram on a canvas, including anything drawn by a custom layer.
   *
   * cytoscape has two ways to produce this and only one of them sees
   * everything. The renderer's own bufferCanvasImage draws the graph;
   * cytoscape-layers composes the graph together with the layers on top of it
   * -- which is where the analysis overlay and the interactor decorations live.
   * Ask the layers when there are any, and the renderer when there are not.
   *
   * Public because the headless render page builds animation frames from it.
   * Going through here rather than cy.png() means a frame contains what the
   * screen contains.
   */
  exportCanvas(cy: cytoscape.Core, options: cytoscape.ExportJpgBlobPromiseOptions) {
    const layers = cy.scratch('_layers') as
      { hasCustomLayer?: () => boolean; toCanvas?: (o: unknown) => HTMLCanvasElement } | undefined;

    return layers?.toCanvas && layers.hasCustomLayer?.()
      ? layers.toCanvas({ ...options, bg: options.bg ?? '#fff' })
      : (
          cy as unknown as {
            renderer: () => { bufferCanvasImage: (o: unknown) => HTMLCanvasElement };
          }
        )
          .renderer()
          .bufferCanvasImage(options);
  }

  /**
   * The diagram as JPEG.
   *
   * Not cy.jpg(). cytoscape-layers replaces cy.png/jpg/jpeg on the instance so
   * custom layers appear in an export, and its jpg() ends with
   * `output(o, this.toCanvas(o), 'image/png')` -- the wrong media type in the
   * JPEG branch. The file was named .jpeg and contained PNG bytes.
   *
   * The override only takes effect when a custom layer exists, which the
   * diagram has and a bare graph does not, so this looks like a cytoscape bug
   * until you notice it only happens here.
   *
   * Take the canvas the layers compose -- so nothing is lost from the picture
   * -- and encode it as JPEG.
   */
  private async jpegBlob(
    cy: cytoscape.Core,
    options: cytoscape.ExportJpgBlobPromiseOptions
  ): Promise<Blob> {
    const canvas = this.exportCanvas(cy, options);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
        'image/jpeg',
        options.quality ?? 0.9
      );
    });
  }

  /**
   * Export the diagram as SVG.
   *
   * cy.svg() comes from Reactome's cytoscape.js fork -- see the overrides entry
   * in package.json -- and is not in upstream cytoscape yet. It runs the
   * renderer's own drawing code against a context that records SVG, so what it
   * produces is what the diagram draws, at any size, with selectable text.
   *
   * No bg is passed: an SVG with no background rect is transparent, which is
   * what the raster exports ask for too.
   */
  private exportSvg() {
    const svgs = this.cys.map((cy) => cy.svg({ full: true }));
    if (!svgs.length) return;

    const blob = new Blob([this.withDiagramFont(this.composeSvgs(svgs))], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.pathwayId()}.svg`;
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  /**
   * Ask the file to fetch the diagram's font when something opens it.
   *
   * The export names the font the style asks for, and the style asks for
   * Roboto, which the page loads but a saved file does not have. Viewers were
   * substituting their default serif, whose metrics are nothing like Roboto's,
   * so labels laid out to fit their shapes no longer did.
   *
   * The font-family in the style now ends in Helvetica/Arial/sans-serif, which
   * is what this falls back to offline or in an editor that ignores @import --
   * close enough that labels still fit. This gets the real thing when the file
   * is opened in a browser with a network, at the cost of one external request
   * from the saved file.
   */
  private withDiagramFont(svg: string): string {
    // Wrapped in CDATA: SVG is XML, and the ampersand in the font URL is an
    // invalid entity reference otherwise -- it made the whole file unparseable.
    const style =
      `<style type="text/css"><![CDATA[@import url('https://fonts.googleapis.com/css2` +
      `?family=Roboto:wght@300;400;500;600&display=block');]]></style>`;
    return svg.replace(/(<svg\b[^>]*>)/, `$1${style}`);
  }

  /**
   * Lay several exported diagrams side by side, for the comparison view.
   *
   * SVG nests, so each diagram goes in as a child <svg> offset along x rather
   * than having its geometry rewritten -- the raster path has to composite
   * bitmaps to do the same thing.
   */
  private composeSvgs(svgs: string[]): string {
    if (svgs.length === 1) return svgs[0];

    const sized = svgs.map((svg) => ({
      svg,
      width: Number(/\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 0),
      height: Number(/\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 0),
    }));

    const width = sized.reduce((total, s) => total + s.width, 0);
    const height = Math.max(...sized.map((s) => s.height));
    if (!width || !height) return svgs[0];

    let x = 0;
    const children = sized
      .map((s) => {
        const child = s.svg.replace('<svg ', `<svg x="${x}" y="0" `);
        x += s.width;
        return child;
      })
      .join('');

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
      ` viewBox="0 0 ${width} ${height}">${children}</svg>`
    );
  }

  async mergeImages(
    images: ImageBitmap[],
    bbs: BoundingBox12[],
    bgColors: string[],
    format: 'image/jpeg' | 'image/png',
    quality?: number
  ): Promise<Blob> {
    // Compute merged canvas size in model space
    const xMin = Math.min(...bbs.map((bb) => bb.x1));
    const yMin = Math.min(...bbs.map((bb) => bb.y1));
    const xMax = Math.max(...bbs.map((bb) => bb.x2));
    const yMax = Math.max(...bbs.map((bb) => bb.y2));

    // Calculate scale ratio between pixel space (image) and model space (bounding box)
    // Assume all images have the same scale - use the first one
    const bbWidth = bbs[0].x2 - bbs[0].x1;
    const scale = images[0].width / bbWidth;

    const mergedWidth = (xMax - xMin) * scale;
    const mergedHeight = (yMax - yMin) * scale;

    const canvas = document.createElement('canvas');
    canvas.width = mergedWidth;
    canvas.height = mergedHeight;
    const ctx = canvas.getContext('2d')!;
    if (format === 'image/jpeg') {
      ctx.fillStyle = this.dark.isDark() ? '#000' : '#fff';
      ctx.fillRect(0, 0, mergedWidth, mergedHeight);
    }

    images.forEach((image, i) => {
      const offsetX = (bbs[i].x1 - xMin) * scale; // shift relative to merged bbox, scaled to pixel space
      const offsetY = (bbs[i].y1 - yMin) * scale;

      // Fill background color for this layer
      ctx.fillStyle = bgColors[i];
      ctx.fillRect(0, 0, mergedWidth, mergedHeight);

      // Draw image on top
      ctx.drawImage(image, offsetX, offsetY);
      image.close();
    });

    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), format, quality));
  }

  zoomToCytoscapeTransform = (x: number) =>
    this.minZoom() *
    Math.pow(this.maxZoom() / this.minZoom(), (x - this.controlMinZoom()) / this.controlRange());
  zoomToControlTransform = (zoomCy: number) =>
    this.controlMinZoom() +
    this.controlRange() *
      (Math.log(zoomCy / this.minZoom()) / Math.log(this.maxZoom() / this.minZoom()));
  thumbnailImg = signal<string>('');
  sizeObserver!: ResizeObserver;
  containerSize = signal<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  thumbnailSize = signal<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  boundingBox = signal<BoundingBoxWH>({ x1: 0, y1: 1, w: 1, h: 1 });

  thumbnailViewBox = computed(
    () => `0 0 ${this.thumbnailSize().width} ${this.thumbnailSize().height}`
  );
  viewportPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  zoomLevel = signal<number>(0.1);
  minZoom = signal<number>(0.1);
  maxZoom = signal<number>(15);

  thumbnailRxA = computed(() => (END_RX - INIT_RX) / (this.maxZoom() - this.minZoom()));
  thumbnailRxB = computed(() => INIT_RX - this.thumbnailRxA() * this.minZoom());
  thumbnailRx = computed(() => this.zoomLevel() * this.thumbnailRxA() + this.thumbnailRxB());

  shrunkViewport = computed(() => {
    // Get bounding box of the entire graph
    const bbox = this.boundingBox();

    // Get current zoom and pan
    const zoom = this.zoomLevel();
    const pan = this.viewportPosition(); // {x, y}

    // Get main container size (in pixels)
    const mainWidth = this.containerSize().width;
    const mainHeight = this.containerSize().height;

    // Define your thumbnail size (in pixels)
    const thumbWidth = this.thumbnailSize().width;
    const thumbHeight = this.thumbnailSize().height;

    // Compute scale factor between global graph and thumbnail
    const scaleX = thumbWidth / bbox.w;
    const scaleY = thumbHeight / bbox.h;
    const scale = Math.min(scaleX, scaleY); // uniform scaling

    // Offset to center the graph in the thumbnail
    const offsetX = (thumbWidth - bbox.w * scale) / 2;
    const offsetY = (thumbHeight - bbox.h * scale) / 2;

    // Viewport dimensions in graph coordinate space
    const viewW = mainWidth / zoom;
    const viewH = mainHeight / zoom;

    // Viewport top-left in graph space
    const viewX = -pan.x / zoom;
    const viewY = -pan.y / zoom;

    // Convert to thumbnail coordinates
    return {
      x: (viewX - bbox.x1) * scale + offsetX,
      y: (viewY - bbox.y1) * scale + offsetY,
      width: viewW * scale,
      height: viewH * scale,
    };
  });

  cy!: cytoscape.Core;
  reactomeStyle!: Style;
  cyCompare!: cytoscape.Core;
  reactomeStyleCompare!: Style;
  legend!: cytoscape.Core;
  cys: cytoscape.Core[] = [];
  reactomeStyles: Style[] = [];

  leafIdToParentIds = new Map<string, string[]>();

  hovering = signal(false);
  selecting = false; // Avoid zooming in diagram when selection came from in diagram
  flagging = false; // Avoid flagging in diagram when flagging came from in diagram

  ngAfterViewInit(): void {
    const container = this.cytoscapeContainer!.nativeElement;
    const compareContainer = this.compareContainer!.nativeElement;
    const legendContainer = this.legendContainer!.nativeElement;

    Object.values(ReactomeEventTypes).forEach((type) => {
      container.addEventListener(type, (e) => this._reactomeEvents$.next(e as ReactomeEvent));
      compareContainer.addEventListener(type, (e) =>
        this._reactomeEvents$.next(e as ReactomeEvent)
      );
      legendContainer.addEventListener(type, (e) => this._reactomeEvents$.next(e as ReactomeEvent));
    });

    this.reactomeStyle = new Style(container);

    this.underlayPadding = extract(this.reactomeStyle.properties.shadow.padding);

    this.diagram.getLegend().subscribe((legend) => {
      this.legend = cytoscape({
        container: legendContainer,
        elements: legend,
        style: this.reactomeStyle?.getStyleSheet(),
        layout: { name: 'preset' },
        boxSelectionEnabled: false,
      });
      this.reactomeStyle?.bindToCytoscape(this.legend);

      this.legend.zoomingEnabled(false);
      this.legend.panningEnabled(false);
      this.legend.minZoom(0);
    });

    this.sizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === container) {
          this.containerSize.set(entry.contentRect);

          // Update min zoom to be able to fit the whole diagram in the resized viewport
          if (this.cy) {
            const bbox = this.boundingBox();
            const minZoom = Math.min(
              this.containerSize().width / (bbox.w + FIT_PADDING),
              this.containerSize().height / (bbox.h + FIT_PADDING)
            );

            this.minZoom.set(minZoom);
            this.cys.forEach((cy) => {
              cy.minZoom(minZoom);
              if (cy.zoom() < minZoom) {
                this.zoomLevel.set(minZoom);
                cy.zoom(minZoom);
              }
            });
          }
        }

        if (entry.target === this.thumbnailRef()?.nativeElement)
          this.thumbnailSize.set(entry.contentRect);
      });
    });

    this.sizeObserver.observe(container);
    const thumbnail = this.thumbnailRef()?.nativeElement;
    if (thumbnail) this.sizeObserver.observe(thumbnail);

    this.loadDiagram();
  }

  /**
  /**
   * Drag state for the thumbnail. Panning follows the pointer once pressed, so
   * the whole gesture is one press-move-release rather than repeated clicks.
   *
   * Deliberately no setPointerCapture: capturing on pointerdown and releasing
   * on pointerup leaks the capture whenever the release does not arrive on the
   * same element, and a retained capture retargets every later pointer event to
   * the thumbnail -- which silently kills right-click, selection and hovering
   * across the whole diagram. Tracking the drag on the window instead cannot
   * leave that behind.
   */
  private thumbnailDragging = false;

  onThumbnailPointerDown(event: PointerEvent) {
    event.preventDefault();
    this.thumbnailDragging = true;
    this.panFromThumbnail(event);
  }

  @HostListener('window:pointermove', ['$event'])
  onWindowPointerMove(event: PointerEvent) {
    if (this.thumbnailDragging) this.panFromThumbnail(event);
  }

  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  endThumbnailDrag() {
    this.thumbnailDragging = false;
  }

  /**
   * Centre the diagram on the point pressed in the thumbnail.
   *
   * This is the inverse of the mapping shrunkViewport() uses to draw the
   * viewport rectangle: that turns graph coordinates into thumbnail pixels, and
   * this turns thumbnail pixels back into graph coordinates. Keep the two in
   * step -- if the scale or centring offset changes in one, the rectangle and
   * the pointer stop agreeing about where the user is pointing.
   */
  private panFromThumbnail(event: PointerEvent) {
    const cy = this.cy;
    const image = this.thumbnailRef()?.nativeElement;
    if (!cy || !image) return;

    const bbox = this.boundingBox();
    if (!bbox.w || !bbox.h) return;

    const { width: thumbWidth, height: thumbHeight } = this.thumbnailSize();
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // thumbnailSize comes from a ResizeObserver on the image's content box,
    // which is the space shrunkViewport() and the svg viewBox both work in.
    // Normalise the pointer into that space rather than assuming it matches
    // the on-screen rectangle.
    // Clamped: the drag is tracked on the window, so the pointer can be well
    // outside the thumbnail and should pin to its edge rather than extrapolate.
    const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
    const thumbX = clamp(((event.clientX - rect.left) / rect.width) * thumbWidth, thumbWidth);
    const thumbY = clamp(((event.clientY - rect.top) / rect.height) * thumbHeight, thumbHeight);

    const scale = Math.min(thumbWidth / bbox.w, thumbHeight / bbox.h);
    const offsetX = (thumbWidth - bbox.w * scale) / 2;
    const offsetY = (thumbHeight - bbox.h * scale) / 2;

    const graphX = (thumbX - offsetX) / scale + bbox.x1;
    const graphY = (thumbY - offsetY) / scale + bbox.y1;

    const zoom = cy.zoom();
    cy.pan({
      x: this.containerSize().width / 2 - graphX * zoom,
      y: this.containerSize().height / 2 - graphY * zoom,
    });
  }

  thumbnailLoaded() {
    const thumbnail = this.thumbnailRef()?.nativeElement;
    if (thumbnail) this.thumbnailSize.set(thumbnail.getBoundingClientRect());
  }

  ngOnDestroy(): void {
    this.sizeObserver.disconnect();
  }

  // Needs Input event binding to react to mouse drag instead of mouse drop on slider
  zoom(inputEvent: Event) {
    this.cy.zoom({
      level: this.zoomToCytoscapeTransform((inputEvent.target as HTMLInputElement).valueAsNumber),
      renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 },
    });
  }

  zoomIn() {
    this.cy.zoom({
      level: this.cy.zoom() * 1.2,
      renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 },
    });
  }

  zoomOut() {
    this.cy.zoom({
      level: this.cy.zoom() / 1.2,
      renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 },
    });
  }

  move(direction: 'up' | 'right' | 'down' | 'left', distance = 50) {
    const x = direction === 'right' ? -distance : direction === 'left' ? distance : 0;
    const y = direction === 'up' ? distance : direction === 'down' ? -distance : 0;
    this.cy.panBy({ x, y });
  }

  fitScreen() {
    this.cy.animate({
      fit: {
        eles: '*',
        padding: FIT_PADDING,
      },
      duration: 1000,
      easing: 'ease-in-out',
    });
  }

  private loadDiagram(): void {
    this.event.diagramPathway$
      .pipe(
        filter(isDefined),
        take(1),
        switchMap((event) => {
          // If the diagramId is a subpathway without diagram, and it is a first load then load parent diagram
          // For instance: ../PathwayBrowser/R-HSA-69541
          if (!isPathwayWithDiagram(event) && this.isInitialLoad) {
            return this.loadSubpathwayWithDiagram(event);
          }
          // Pathway with a diagram
          return this.loadElvDiagram();
        }),
        catchError(() => of(null))
      )
      .subscribe(() => {
        this.isInitialLoad = false;
      });
  }

  loadElvDiagram(): Observable<ElementsDefinition> {
    if (!this.cytoscapeContainer) return EMPTY; // Prevent execution if the container is not present

    const container = this.cytoscapeContainer.nativeElement;
    return this.diagram.getDiagram(this.pathwayId()!).pipe(
      tap((elements) => {
        this.comparing =
          elements.nodes.some((node) => node.data['isFadeOut']) ||
          elements.edges.some((edge) => edge.data['isFadeOut']);

        this.cy = cytoscape({
          container: container,
          elements: elements,
          style: this.reactomeStyle?.getStyleSheet(),
          layout: { name: 'preset' },
        });
        this.cys[0] = this.cy;
        this.reactomeStyles[0] = this.reactomeStyle;
        this.reactomeStyle.bindToCytoscape(this.cy);

        this.leafIdToParentIds.clear();
        this.cy.nodes().forEach((node) => {
          node.data('graph.leaves')?.forEach((leaf: Graph.Node) => {
            if (!this.leafIdToParentIds.has(leaf.stId)) this.leafIdToParentIds.set(leaf.stId, []);
            if (leaf.standardIdentifier && !this.leafIdToParentIds.has(leaf.standardIdentifier))
              this.leafIdToParentIds.set(
                leaf.standardIdentifier,
                this.leafIdToParentIds.get(leaf.stId)!
              );
            const parents = this.leafIdToParentIds.get(leaf.stId)!;
            parents.push(node.data('graph.stId'));
          });
        });

        this.cy.on('zoom', () => this.controlZoom.set(this.zoomToControlTransform(this.cy.zoom())));

        this.reactomeStyle.clearCache();
        this.cy.on('dblclick', '.SUB.Pathway', (e) => {
          void this.state.navigateTo(e.target.data('graph.stId'), {
            queryParamsHandling: 'preserve',
            preserveFragment: true,
          });
        });

        // Right-click menu on entities. The old site offered Molecule /
        // Pathways / Interactors here and curators still reach for it; each
        // item is a shortcut to somewhere the details panel already goes.
        this.cy.on('cxttap', '.PhysicalEntity', (e) => {
          const stId = e.target.data('graph.stId');
          if (!stId) return;
          const pointer = e.originalEvent as MouseEvent | undefined;
          if (!pointer) return;
          this.popupTarget.set({
            x: pointer.clientX,
            y: pointer.clientY,
            stId,
            label: e.target.data('displayName') || e.target.data('graph.displayName') || stId,
            acc: e.target.data('acc') || undefined,
          });
          // Production also moves the details panel to the entity you
          // right-clicked, so the popup and the panel agree. Flagged as an
          // in-diagram selection, or the select effect animates a fit to the
          // node and a right-click would yank the whole diagram around.
          this.popupViewport = { zoom: this.cy.zoom(), pan: { ...this.cy.pan() } };
          this.selecting = true;
          this.state.select.set(stId);
        });

        // Right-clicking the background dismisses it.
        this.cy.on('cxttap', (e) => {
          if (e.target === this.cy) this.popupTarget.set(null);
        });

        this.cy.on('dblclick', '.Interacting.Pathway', (e) => {
          void this.state.navigateTo(e.target.data('graph.stId'), {
            queryParams: { select: this.pathwayId() },
            queryParamsHandling: 'merge',
            preserveFragment: true,
          });
        });

        const shadowNodes = this.cy?.nodes('.Shadow');
        this.event.setSubpathwayColors(
          shadowNodes && shadowNodes.length > 0
            ? new Map(shadowNodes.map((node) => [node.data('reactomeId'), node.data('color')]))
            : undefined
        );

        setTimeout(() => {
          this.thumbnailImg.set(this.cy.png({ full: true, maxHeight: 240 }));
        }, 5);
        this.cy.on('viewport', () => {
          this.zoomLevel.set(this.cy.zoom());
          this.viewportPosition.set({ ...this.cy.pan() });
        });

        this.zoomLevel.set(this.cy.zoom());
        this.minZoom.set(this.cy.minZoom());
        this.maxZoom.set(this.cy.maxZoom());
        this.viewportPosition.set({ ...this.cy.pan() });
        this.boundingBox.set(
          this.cy.elements().boundingBox({
            includeEdges: true,
            includeNodes: true,

            includeLabels: false,
            includeMainLabels: false,
            includeOverlays: false,
            includeUnderlays: false,
            includeSourceLabels: false,
            includeTargetLabels: false,
          })
        );

        this.loadCompare(elements, container);

        this.avoidSideEffect(() => this.stateToDiagram());
      })
    );
  }

  loadSubpathwayWithDiagram(event: EventModel) {
    return this.event.fetchEventAncestors(this.pathwayId()!).pipe(
      map((ancestors) => this.event.getFinalAncestor(ancestors)),
      switchMap((ancestors) => {
        const pathwayWithDiagram = this.event.getPathwayWithDiagram(event);
        if (pathwayWithDiagram) {
          const newDiagramId = pathwayWithDiagram.stId;
          const diagramId = this.pathwayId();
          if (newDiagramId !== diagramId) {
            this.pathwayId.set(newDiagramId);
            // this.router.navigate([diagramId], {
            //   queryParamsHandling: "preserve"
            // }).then(() => {
            this.state.select.set(event.stId);
            // });

            return this.loadElvDiagram();
          }
        }
        return of(null);
      })
    );
  }

  public initialiseReplaceElements() {
    if (this.comparing)
      this.cy.batch(() => {
        this.cy.elements('[!isBackground]').style('visibility', 'hidden');
        this.cy.edges('.shadow').style('underlay-padding', 0);
        this.lastIndex = 0;
        this.updateReplacementVisibility();
        this.cy.elements('.Compartment').style('visibility', 'visible');
      });
  }

  private loadCompare(elements: cytoscape.ElementsDefinition, container: HTMLDivElement) {
    const getPosition = (e: cytoscape.SingularElementArgument) =>
      e.is('.Shadow') ? e.data('triggerPosition') : e.boundingBox().x1;
    if (this.comparing) {
      this.cy.elements('[!isBackground]').style('visibility', 'hidden');
      this.replacedElements = this.cy!.elements('[?replacedBy]')
        .add('[?isCrossed]')
        .sort((a, b) => getPosition(a) - getPosition(b))
        .style('visibility', 'hidden')
        .toArray();

      this.replacedElementsPosition = this.replacedElements.map(getPosition);

      this.cy.on('add', (e) => {
        const addedElement = e.target;
        if (addedElement.data('replacedBy') || addedElement.data('isCrossed')) {
          const x = getPosition(addedElement);
          let index = this.replacedElementsPosition.findIndex((x1) => x1 >= x);
          if (index === -1) index = this.replacedElements.length;

          this.replacedElements.splice(index, 0, addedElement);
          this.replacedElementsPosition.splice(index, 0, x);
          addedElement.style('visibility', 'hidden');
        }
      });

      this.cy.on('remove', (e) => {
        const removedElement = e.target;
        const index = this.replacedElements.indexOf(removedElement);
        if (index > -1) {
          this.replacedElements.splice(index, 1);
          this.replacedElementsPosition.splice(index, 1);
        }
      });

      const compareContainer = this.compareContainer!.nativeElement;
      this.cyCompare = cytoscape({
        container: compareContainer,
        elements: elements,
        style: this.reactomeStyle?.getStyleSheet(),
        layout: { name: 'preset' },
      });

      this.cyCompare.elements('[?isFadeOut]').remove();
      this.cyCompare.elements('.Compartment').remove();
      this.cy!.nodes('.crossed').removeClass('crossed');

      this.cyCompare!.on('viewport', () =>
        this.syncViewports(this.cyCompare, compareContainer, this.cy, container)
      );
      this.cy!.on('viewport', () =>
        this.syncViewports(this.cy, container, this.cyCompare, compareContainer)
      );

      this.reactomeStyleCompare = new Style(compareContainer);
      this.reactomeStyleCompare?.bindToCytoscape(this.cyCompare);
      this.cyCompare.minZoom(this.cy!.minZoom());
      this.cyCompare.maxZoom(this.cy!.maxZoom());

      this.cys[1] = this.cyCompare;
      this.reactomeStyles[1] = this.reactomeStyleCompare;

      setTimeout(() => {
        this.syncViewports(this.cy!, container, this.cyCompare, compareContainer);
        this.initialiseReplaceElements();
      });
    }
  }

  readonly classRegex = /class:(\w+)([!.]drug)?/;

  getElements(
    tokens: (string | number)[],
    cy: cytoscape.Core,
    includeContainers = false
  ): cytoscape.CollectionArgument {
    let elements: cytoscape.Collection;

    elements = cy.collection();
    tokens.forEach((token) => {
      if (typeof token === 'string') {
        if (token.startsWith('R-')) {
          let tokenElements = cy.collection(`[graph.stId="${token}"]`);
          // Load children
          if (
            (includeContainers || tokenElements.length === 0) &&
            this.leafIdToParentIds.has(token)
          )
            this.leafIdToParentIds
              .get(token)!
              .forEach((parent) => (tokenElements = tokenElements.or(`[graph.stId="${parent}"]`)));
          elements = elements.or(tokenElements);

          // Consider it as a subpathway when there are no elements found and get all reactions
          if (elements.length === 0) {
            const allSubpathwaysElements = elements.or('[subpathways]');
            allSubpathwaysElements.forEach((ele) => {
              const pathwayList = ele.data('subpathways');
              if (pathwayList.includes(token)) {
                elements.merge(ele);
              }
            });
          }
        } else if (token.includes(':') && !token.startsWith('class')) {
          // ReferenceEntity stId
          elements = elements.or(`[graph.standardIdentifier="${token}"]`);
          if ((includeContainers || elements.length === 0) && this.leafIdToParentIds.has(token))
            this.leafIdToParentIds
              .get(token)!
              .forEach((parent) => (elements = elements.or(`[graph.stId="${parent}"]`)));
        } else {
          // work with class ➡️ [class:Molecule!drug]
          const matchArray = token.match(this.classRegex);
          if (matchArray) {
            const [_, clazz, drug] = matchArray;
            if (drug === '.drug') {
              // Drug physical entity
              elements = elements.or(`.${clazz}`).and('.drug');
            } else if (drug === '!drug') {
              // Non drug physical entity
              elements = elements.or(`.${clazz}`).not('.drug');
            } else {
              // Reactions
              elements = elements.or(`.${clazz}`);
              elements = elements.or(elements.nodes('.reaction').connectedEdges());
            }
          } else {
            elements = elements.or(`[acc="${token}"]`);
          }
        }
      } else {
        elements = elements.or(`[acc="${token}"]`).or(`[reactomeId="${token}"]`);
      }
    });
    return elements;
  }

  select(tokens: string | number, cy: cytoscape.Core): cytoscape.CollectionArgument {
    cy.elements(':selected').unselect();
    const includeContainers = typeof tokens === 'string' && isReferenceEntityStId(tokens);
    let selected = this.getElements([tokens], cy, includeContainers);
    selected.select();
    if ('connectedNodes' in selected) {
      selected = selected.add(selected.connectedNodes());
    }

    if (cy === this.cy) {
      let running = true;

      this.cy.animate(
        {
          fit: { eles: selected, padding: 100 },
          duration: 1000,
          easing: 'ease-in-out',
        },
        {
          complete: () => {
            running = false;
          },
        }
      );

      if (this.cyCompare) {
        const syncFrame = () => {
          if (!running) return;
          this.syncViewports(
            this.cy,
            this.cytoscapeContainer!.nativeElement,
            this.cyCompare,
            this.compareContainer!.nativeElement,
            true
          );
          requestAnimationFrame(syncFrame);
        };
        requestAnimationFrame(syncFrame);
      }
    }

    return selected;
  }

  getFittedViewport(cy: cytoscape.Core, eles: cytoscape.CollectionArgument, padding = 100) {
    // Save original state
    const origPan = cy.pan();
    const origZoom = cy.zoom();

    let targetPan, targetZoom;

    cy.batch(() => {
      // Jump to the fit position
      cy.fit(eles, padding);

      // Read target values
      targetPan = { ...cy.pan() };
      targetZoom = cy.zoom();

      // Restore original state
      cy.pan(origPan);
      cy.zoom(origZoom);
    });

    console.log(targetPan, targetZoom, origPan, origZoom);

    return {
      pan: { ...(targetPan! as cytoscape.Position) },
      zoom: targetZoom! as number,
    };
  }

  flag(accs: (string | number)[], cy: cytoscape.Core): cytoscape.CollectionArgument {
    return this.flagElements(this.getElements(accs, cy, true), cy);
  }

  flagElements(
    toFlag: cytoscape.CollectionArgument,
    cy: cytoscape.Core
  ): cytoscape.CollectionArgument {
    if (toFlag.nonempty()) {
      cy.batch(() => {
        this.setSubPathwayVisibility(false, cy);
        cy.elements().removeClass('flag');
        toFlag.addClass('flag').edges().style({ 'underlay-opacity': 1 });
      });

      return toFlag;
    } else {
      cy.batch(() => {
        this.setSubPathwayVisibility(true, cy);
        cy.elements().removeClass('flag');
        cy.edges().not('[?color]').style({ 'underlay-opacity': 0 });
      });

      return cy.collection();
    }
  }

  setSubPathwayVisibility(visible: boolean, cy: cytoscape.Core) {
    const shadowNodes = cy.nodes('.Shadow');
    const shadowEdges = cy.edges('[?color]');
    const trivials = cy.elements('.trivial');
    // Must be this graph's own handler. cy.off() matches on function identity,
    // and the shared Style hands back whichever graph was bound last -- often
    // the legend, whose handler was never registered here, so the diagram's own
    // handler survived and kept re-applying zoom-based opacity to the trivial
    // molecules that flagging had just made visible.
    const onZoomShadow = interactivityOf(cy)?.onZoom.shadow;

    if (visible) {
      shadowNodes.style({ opacity: 1 });
      // Hand the trivial molecules back to the zoom handler, which owns their
      // opacity again from here.
      trivials.removeClass('always-visible');
      shadowEdges.addClass('shadow');
      if (onZoomShadow) {
        cy.on('zoom', onZoomShadow);
        onZoomShadow();
      }
    } else {
      shadowNodes.style({ opacity: 0 });
      shadowEdges.removeClass('shadow');
      if (onZoomShadow) cy.off('zoom', onZoomShadow);
      // A class, not an inline style: with the handler detached nothing would
      // put the opacity back if it were lost, and the base .trivial rule is 0.
      // The inline value the zoom handler last wrote has to go first, because
      // in cytoscape an inline style beats any stylesheet rule -- leaving it in
      // place is what pins the molecules at whatever opacity the zoom level
      // happened to have when flagging started.
      trivials.removeStyle('opacity').addClass('always-visible');
      cy.edges().style({ 'underlay-opacity': 0 });
    }
  }

  applyEvent(
    event: ReactomeEvent,
    affectedElements: cytoscape.NodeCollection | cytoscape.EdgeCollection
  ) {
    switch (event.type) {
      case ReactomeEventTypes.hover:
        affectedElements.addClass('hover');
        this.hovering.set(true);
        break;
      case ReactomeEventTypes.leave:
        affectedElements.removeClass('hover');
        this.hovering.set(false);
        break;
      case ReactomeEventTypes.select:
        affectedElements.select();
        break;
      case ReactomeEventTypes.unselect:
        affectedElements.unselect();
        break;
    }
  }

  ratio = 0.384;

  replacedElements!: cytoscape.SingularElementArgument[];
  replacedElementsPosition: number[] = [];

  lastIndex = 0;
  underlayPadding = 0;

  private updateReplacementVisibility() {
    // // Calculate the position of the element that is to the right of the separation

    const extent = this.cyCompare!.extent();
    let limitIndex = this.replacedElementsPosition.findIndex((x1) => x1 >= extent.x1);
    if (limitIndex === -1) limitIndex = this.replacedElements.length;

    /// Alternative calculation. In theory more optimised, but seems worse when console is opened for some reason

    // const currentPos = this.cyCompare!.extent().x1;
    // let limitIndex = this.lastIndex;
    // let i = this.lastIndex;
    // if (currentPos > this.lastPosition) { // Dragging to the right
    //   while (i >= 0 && this.replacedElementsPosition[i] < currentPos) i++;
    //   limitIndex = i;
    // } else if (currentPos < this.lastPosition) { // Dragging to the left
    //   do i--;
    //   while (i < this.replacedElementsPosition.length  && this.replacedElementsPosition[i] >= currentPos)
    //   limitIndex = i+1;
    // }
    //
    // this.lastPosition = currentPos;
    // ---------

    if (this.lastIndex !== limitIndex) {
      // If at least one element is switched from left to right
      if (limitIndex < this.lastIndex)
        this.replacedElements
          .slice(limitIndex, this.lastIndex)
          .map((e) => e.style('visibility', 'hidden')) // Hide the range of elements
          .filter((e) => e.is('.Shadow')) // And if it is an shadow
          .forEach((shadow) => shadow.data('edges').style('underlay-padding', 0)); // Hide as well the associated reaction underlay
      // If at least one element is switched from right to left
      if (limitIndex > this.lastIndex)
        this.replacedElements
          .slice(this.lastIndex, limitIndex)
          .map((e) => e.style('visibility', 'visible')) // Show the range of elements
          .filter((e) => e.is('.Shadow')) // And if it is an shadow
          .forEach((shadow) =>
            shadow.data('edges').style('underlay-padding', this.underlayPadding)
          ); // Show as well the associated reaction underlay
    }
    this.lastIndex = limitIndex;
  }

  syncing = false;
  syncViewports = (
    source: cytoscape.Core,
    sourceContainer: HTMLElement,
    target: cytoscape.Core,
    targetContainer: HTMLElement,
    overrideIgnore = false
  ) => {
    if (this.syncing && !overrideIgnore) return;
    if (!overrideIgnore) this.syncing = true;
    this.updateReplacementVisibility();

    const position = { ...source.pan() };
    const sourceX = sourceContainer.getBoundingClientRect().x;
    const targetX = targetContainer.getBoundingClientRect().x;
    position.x += sourceX - targetX;
    target.viewport({
      zoom: source.zoom(),
      pan: position,
    });
    if (!overrideIgnore) this.syncing = false;
  };

  private loadAnalysis(token: string | null) {
    const diagramId = this.pathwayId();
    if (!token || !diagramId) {
      this._loadAnalysisFn = undefined;

      this.cys.forEach((cy) => {
        cy.batch(() => {
          cy.nodes().removeData('exp');
          cy.edges('[?color]').style({
            'underlay-padding': extract(this.reactomeStyle.properties.shadow.padding),
          });
          cy.nodes('.Shadow').style({
            'font-size': extract(this.reactomeStyle.properties.shadow.fontSize),
            'text-outline-width': extract(this.reactomeStyle.properties.shadow.fontPadding),
          });
        });
      });
      this.reactomeStyles.forEach((style) =>
        style.loadAnalysis(style.cy!, this.analysis.palette().scale)
      );
      return;
    }

    forkJoin({
      entities: this.analysis.foundEntities(
        this.data.currentPathway()?.normalPathway?.stId || diagramId,
        token
      ),
      pathways: this.analysis.pathwaysResults(
        this.cy?.nodes('.Pathway').map((p) => p.data('reactomeId')) || [],
        token
      ),
      result: this.analysis.result$.pipe(filter(isDefined), take(1)),
    }).subscribe(({ entities, pathways, result }) => {
      this._loadAnalysisFn = (analysisIndex) => {
        const analysisEntityMap = new Map<string, number>(
          entities.entities.flatMap((entity) =>
            entity.mapsTo
              .flatMap((diagramEntity) => diagramEntity.ids)
              .map((id) => [id, entity.exp[analysisIndex] || 0])
          )
        );

        const analysisPathwayMap = new Map<number, Analysis.Pathway['entities']>(
          pathways.map((p) => [p.dbId, p.entities])
        );
        const includeInteractors = result.summary.interactors;

        this.cys.forEach((cy) => {
          cy.batch(() => {
            const style: Style = cy.data('reactome');

            cy.nodes('.InteractorOccurrences').forEach((occurence) => {
              if (includeInteractors) {
                const interactors: Interactor[] = occurence.data('interactors');
                const exps = interactors.map((i) => analysisEntityMap.get(i.acc)).filter(isDefined);
                if (interactors && exps.length > 0) {
                  occurence.data('exp', [average(exps)]);
                } else {
                  occurence.data('exp', [undefined]);
                }
              } else {
                occurence.removeData('exp');
              }
            });

            cy.nodes('.PhysicalEntity').forEach((node) => {
              if (node.hasClass('Interactor') && !includeInteractors) return; // Avoid coloring interactors when analysis does not include them

              const leaves: Graph.Node[] = node.data('graph.leaves') || [node.data('graph')];
              const exp = leaves
                ?.map((leaf) => analysisEntityMap.get(leaf.identifier))
                ?.sort((a, b) => (a !== undefined ? (b !== undefined ? a - b : -1) : 1));
              // if (hasExpression) exp = exp.map(e => e !== undefined ? 1 - e : undefined);
              node.data('exp', exp);
            });
            cy.nodes('.Pathway').forEach((node) => {
              const dbId: number = node.data('reactomeId');
              const pathwayData = analysisPathwayMap.get(dbId);
              if (!pathwayData) {
                node.data('exp', [undefined]);
              } else {
                node.data('exp', [
                  [pathwayData.exp[analysisIndex] || pathwayData.fdr, pathwayData.found],
                  [undefined, pathwayData.total - pathwayData.found],
                ]);
              }
            });

            cy.edges('[?color]').style({ 'underlay-padding': 8 });
            cy.nodes('.Shadow').style({
              'font-size': extract(style.properties.shadow.fontSize) / 2,
              'text-outline-width': extract(style.properties.shadow.fontPadding) / 2,
            });

            this.reactomeStyles.forEach((style) =>
              style.loadAnalysis(style.cy!, this.analysis.palette().scale)
            );
          });
        });
      };

      this._loadAnalysisFn(this.analysis.sampleIndex());
    });
  }

  private _loadAnalysisFn: ((analysisIndex: number) => void) | undefined;

  updateStyle() {
    this.cy
      ? setTimeout(() => {
          this.reactomeStyle?.update(this.cy);
          this.thumbnailImg.set(this.cy.png({ full: true, maxHeight: 240 }));
        }, 5)
      : null;
    this.cyCompare ? setTimeout(() => this.reactomeStyle?.update(this.cyCompare), 5) : null;
    this.legend ? setTimeout(() => this.reactomeStyle?.update(this.legend), 5) : null;
  }

  compareDragging = false;

  dragStart() {
    this.compareDragging = true;
  }

  dragEnd() {
    this.compareDragging = false;
  }

  dragMove(
    $event: MouseEvent | TouchEvent,
    compareContainer: HTMLDivElement,
    container: HTMLDivElement
  ) {
    if (!this.compareDragging) return;
    const x = $event instanceof TouchEvent ? $event.touches[0].clientX : $event.x;
    compareContainer.style['left'] = x - container.getBoundingClientRect().x + 'px';
    this.cyCompare.resize();
    this.syncViewports(
      this.cy!,
      this.cytoscapeContainer!.nativeElement,
      this.cyCompare!,
      this.compareContainer!.nativeElement
    );
  }

  legendPosition = signal<Point>({ x: 0, y: 0 });
  animateLegend = signal(false);
  updateLegend() {
    this.legend.resize();
    this.legend.panningEnabled(true);
    this.legend.zoomingEnabled(true);
    this.legend.fit(this.legend.elements(), 2);
    this.legend.panningEnabled(false);
    this.legend.zoomingEnabled(false);
  }

  toggleLegend(legendWidth: number) {
    this.animateLegend.set(true);
    this.legendPosition().x <= -legendWidth + 5
      ? this.legendPosition.set({ x: 0, y: 0 })
      : this.legendPosition.set({ x: -legendWidth, y: 0 });
    this.updateLegend();
    setTimeout(() => this.animateLegend.set(false), 500);
  }

  // ----- Event Syncing -----
  private _reactomeEvents$: Subject<ReactomeEvent> = new Subject<ReactomeEvent>();

  private _ignore = false;

  avoidSideEffect(m: () => any) {
    this._ignore = true;
    m();
    this._ignore = false;
  }

  @Output()
  public reactomeEvents$: Observable<ReactomeEvent> = this._reactomeEvents$.asObservable().pipe(
    distinctUntilChanged(
      (prev, current) =>
        prev.type === current.type && prev.detail.reactomeId === current.detail.reactomeId
    ),
    // tap(e => console.log(e.type, e.detail, e.detail.element.data(), e.detail.cy.container()?.id)),
    filter(() => !this._ignore),
    share()
  );

  private stateToDiagram() {
    for (const cy of this.cys) {
      this.flag(this.data.flagIdentifiers(), cy);
      this.select(this.state.select()!, cy);
    }

    const resource = this.state.overlay();
    if (resource) {
      //console.log('Resource not null', resource)
      this.interactorsComponent()?.getInteractors(resource);
    }

    this.loadAnalysis(this.state.analysis());
  }

  compareBackgroundSync = this.reactomeEvents$
    .pipe(
      filter(() => this.comparing),
      filter((e) => e.detail.cy !== this.legend)
    )
    .subscribe((event) => {
      const src = event.detail.cy;
      const tgt = src === this.cy ? this.cyCompare : this.cy;

      let replacedBy = event.detail.element.data('replacedBy');
      replacedBy = replacedBy || event.detail.element.data('replacement');
      replacedBy =
        replacedBy ||
        (event.detail.element.data('isBackground') &&
          !event.detail.element.data('isFadeOut') &&
          event.detail.element.data('id'));

      if (!replacedBy) return;

      let replacements = tgt.getElementById(replacedBy);
      if (event.detail.type === 'reaction') {
        replacements = replacements.add(tgt.elements(`[reactionId=${replacedBy}]`));
      }

      this.applyEvent(event, replacements);
    });

  interactorOpeningHandling = this.reactomeEvents$
    .pipe(
      filter((e) => e.detail.cy !== this.legend),
      filter((e) =>
        [ReactomeEventTypes.open, ReactomeEventTypes.close].includes(e.type as ReactomeEventTypes)
      ),
      filter((e) => e.detail.type === 'Interactor')
    )
    .subscribe((e) => {
      [this.reactomeStyle, this.reactomeStyleCompare]
        .filter((s) => s !== undefined && e.detail.cy === s.cy)
        .forEach((style) => {
          const occurrenceNode = e.detail.element.nodes()[0];

          if (e.type === ReactomeEventTypes.open)
            this.interactorsService.addInteractorNodes(occurrenceNode, style.cy!);
          else this.interactorsService.removeInteractorNodes(occurrenceNode);

          style.interactivity.updateProteins();
          style.interactivity.triggerZoom();
        });

      if (this.comparing) {
        this.initialiseReplaceElements();
      }

      if (this._loadAnalysisFn) this._loadAnalysisFn(this.analysis.sampleIndex());
    });

  diagram2legend = this.reactomeEvents$
    .pipe(filter((e) => e.detail.cy !== this.legend))
    .subscribe((event) => {
      const classes = event.detail.element.classes();
      const firstClassToMatch = classes[0];

      // Only get the first matched item in the classes, this help to filter out the polymer when hovering on a molecule
      let matchingElement: cytoscape.NodeCollection | cytoscape.EdgeCollection = this.legend
        .elements(`.${firstClassToMatch}`)
        .filter((ele) => {
          const classes = ele.classes();
          return Array.isArray(classes) && classes[0] === firstClassToMatch;
        });

      if (event.detail.type === SchemaClasses.PE) {
        if (classes.includes('drug')) matchingElement = matchingElement.nodes('.drug');
        else matchingElement = matchingElement.not('.drug');
      } else if (event.detail.type === 'reaction') {
        const reaction = event.detail.element.nodes('.reaction');
        matchingElement = this.legend.nodes(`.${reaction.classes()[0]}`).first();
        matchingElement = matchingElement.add(matchingElement.connectedEdges());
      }

      this._ignore = true;
      this.applyEvent(event, matchingElement);
      this._ignore = false;
    });

  diagramSelect2state = this.reactomeEvents$
    .pipe(
      filter((e) => e.detail.cy !== this.legend && e.type === ReactomeEventTypes.select),
      // filter(e => e.detail.cy !== this.cy),
      delay(5) // allow for unselect to be processed before select when clicking on an already selected element
    )
    .subscribe((e) => {
      const elements: cytoscape.NodeSingular = e.detail.element;
      const reactomeIds = elements.map((el) => el.data('graph.stId'));
      this.selecting = true;
      this.state.select.set(reactomeIds[0]);
    });

  diagramUnselect2state = this.reactomeEvents$
    .pipe(filter((e) => e.detail.cy !== this.legend && e.type === ReactomeEventTypes.unselect))
    .subscribe((e) => {
      if (this.state.select() === e.detail.element.data('graph.stId')) {
        //console.log('Unselect', e.detail.reactomeId)
        this.state.select.set(null);
      }
    });

  legend2state = this.reactomeEvents$
    .pipe(
      filter((e) => e.detail.cy === this.legend),
      filter(() => !this._ignore),
      distinctUntilChanged(
        (previous, next) =>
          next.detail.element.id() === previous.detail.element.id() && next.type === previous.type
      )
    )
    .subscribe((e) => {
      const event = e as ReactomeEvent;
      const classes = event.detail.element.classes();
      for (const cy of [this.cy, this.cyCompare].filter(isDefined)) {
        let matchingElement: cytoscape.NodeCollection | cytoscape.EdgeCollection = cy.elements(
          `.${classes[0]}`
        );

        // TODO move everything to use state

        if (event.detail.type === 'PhysicalEntity' || event.detail.type === 'Pathway') {
          if (classes.includes('drug')) matchingElement = matchingElement.nodes('.drug');
          else matchingElement = matchingElement.not('.drug');
        } else if (event.detail.type === 'reaction') {
          const reaction = event.detail.element.nodes('.reaction');
          matchingElement = this.cy.nodes(`.${reaction.classes()[0]}`);
          matchingElement = matchingElement.add(matchingElement.connectedEdges());
        }

        switch (event.type) {
          case ReactomeEventTypes.select:
            this.flagging = true;
            this.state.flag.set([
              'class:' +
                classes[0] +
                (event.detail.type === 'reaction'
                  ? ''
                  : (classes.includes('drug') ? '.' : '!') + 'drug'),
            ]);
            break;
          case ReactomeEventTypes.unselect:
            this.flagging = true;
            this.state.flag.set([]);
            break;
          case ReactomeEventTypes.hover:
            matchingElement.addClass('hover');
            break;
          case ReactomeEventTypes.leave:
            matchingElement.removeClass('hover');
            break;
        }
      }
    });

  logProteins() {
    console.debug(
      new Set(this.cy.nodes('.Protein').map((node) => node.data('acc') || node.data('iAcc')))
    );
  }

  /**
   * A row in the popup was clicked.
   *
   * A pathway is somewhere to go, so it navigates. A molecule is selected,
   * which moves the diagram to it -- as production does. Deliberately NOT
   * flagged as an in-diagram selection, so the select effect animates the fit.
   *
   * What production leaves you without is a way back, which is the confusing
   * part rather than the movement itself; the popup title does that here.
   */
  onPopupNavigate(event: { stId: string; kind: EntityPopupTab }): void {
    if (event.kind === 'pathways') {
      this.popupTarget.set(null);
      void this.state.navigateTo(event.stId, {
        queryParamsHandling: 'preserve',
        preserveFragment: true,
      });
      return;
    }
    this.state.select.set(event.stId);
  }

  /**
   * The popup title was clicked: go back to the entity it is about.
   *
   * Clicking a molecule flies the diagram off to that component, and with the
   * popup still titled by the original entity there was no obvious way back.
   * Selecting it again returns the diagram there.
   */
  onPopupRecenter(): void {
    const target = this.popupTarget();
    if (!target) return;

    // Re-select without letting the select effect fit, then put the viewport
    // back exactly where it was.
    this.selecting = true;
    this.state.select.set(target.stId);

    const viewport = this.popupViewport;
    if (viewport) {
      this.cy.animate(
        { zoom: viewport.zoom, pan: viewport.pan },
        { duration: 500, easing: 'ease-in-out' }
      );
    }
  }
}
