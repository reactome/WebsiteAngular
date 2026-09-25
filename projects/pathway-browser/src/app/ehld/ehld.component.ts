import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  model,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { EhldService, LegendGroup } from '../services/ehld.service';
import { UntilDestroy } from '@ngneat/until-destroy';
import { UrlStateService } from '../services/url-state.service';
import SvgPanZoom from 'svg-pan-zoom';
import { AnalysisService } from '../services/analysis.service';
import { isDefined } from '../services/utils';
import { Style } from 'reactome-cytoscape-style';
import { rxResource } from '@angular/core/rxjs-interop';
import { DataStateService } from '../services/data-state.service';
import { Point } from '@angular/cdk/drag-drop';
import {
  defaultDownloadOptions,
  DownloadFormat,
  DownloadService,
} from '../services/download.service';
import { SvgExporterService } from '../reacfoam/svg-exporter.service';
import { map } from 'rxjs';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { AnalysisLegendComponent } from '../legend/analysis-legend/analysis-legend.component';
import { NgClass } from '@angular/common';
import { parseEhldSvg } from './ehld-svg';

@Component({
  selector: 'cr-ehld',
  templateUrl: './ehld.component.html',
  styleUrls: ['./ehld.component.scss'],
  standalone: true,
  imports: [CdkDrag, CdkDragHandle, MatSlider, MatSliderThumb, MatTooltip, AnalysisLegendComponent],
})
@UntilDestroy()
export class EhldComponent implements AfterViewInit, OnDestroy {
  private ehldService: EhldService = inject(EhldService);
  public analysis: AnalysisService = inject(AnalysisService);
  public state: UrlStateService = inject(UrlStateService);
  private data: DataStateService = inject(DataStateService);
  private download: DownloadService = inject(DownloadService);
  private svgExporter: SvgExporterService = inject(SvgExporterService);

  ehldContainer = viewChild.required<ElementRef<HTMLDivElement>>('ehld');
  readonly pathwayId = model.required<string>();
  hovering = signal(false);
  /** Set when the fetched file cannot be drawn; the template says so instead of showing nothing. */
  readonly drawError = signal<string | null>(null);

  /**
   * Whether the pathway on screen is known to have an illustration.
   *
   * Double-clicking a region sets `pathwayId` at once, but whether that pathway
   * has an illustration arrives later with its data; most sub-pathways have a
   * diagram instead, and their illustration request fails. Until the data says
   * this pathway has an illustration, a failed fetch is expected, not an error
   * to announce -- the viewport is about to swap this component out.
   */
  private readonly expectsIllustration = computed(() => {
    const pathway = this.data.currentPathway();
    const id = this.pathwayId();
    return !!pathway?.hasEHLD && (pathway.stId === id || String(pathway.dbId) === id);
  });

  /** A fetch that failed for a pathway that should have had an illustration. */
  readonly loadError = computed(() => !!this.svgData.error() && this.expectsIllustration());

  readonly svgData = rxResource({
    params: () => ({ id: this.pathwayId() }),
    stream: (params) =>
      this.ehldService
        .getSVGData(params.params.id)
        .pipe(
          map((data) =>
            data
              .replaceAll('opacity="0.01"', 'opacity="0"')
              .replaceAll('opacity: 0.01', 'opacity: 0')
          )
        ),
  });

  style!: Style;
  ratio = 0.384;

  stIdToSVGGElement = signal(new Map<string, SVGGElement>());
  subpathwayStIds = computed(() => [...this.stIdToSVGGElement().keys()]);
  selectedElement = linkedSignal(() =>
    this.state.select() ? this.stIdToSVGGElement().get(this.state.select()!) : undefined
  );
  flaggedElements = computed(() =>
    this.data
      .flagIdentifiers()
      .map((stId) => this.stIdToSVGGElement().get(stId))
      .filter(isDefined)
  );
  panZoomInstance?: SvgPanZoom.Instance;
  legendItems: LegendGroup[] = [...this.ehldService.legendItems];
  resizeObserver!: ResizeObserver;
  readonly controlZoom = signal<number>(0);
  readonly controlMinZoom = signal<number>(1);
  readonly controlMaxZoom = signal<number>(15);

  private initialZoom = 1;
  private initialPan = { x: 0, y: 0 };
  currentSample?: string;

  constructor() {
    effect(
      () =>
        this.selectedElement() &&
        this.ehldService.applyOutline(this.selectedElement()!, this.flaggedElements())
    );
    effect(() => this.flaggedElements().forEach((g) => this.ehldService.applyFlagOutline(g)));
    effect(() => {
      const text = this.svgData.value();
      if (text && this.ehldContainer()) {
        let svg: SVGSVGElement;
        try {
          svg = parseEhldSvg(text);
        } catch (error) {
          this.clearDrawing();
          this.drawError.set(error instanceof Error ? error.message : String(error));
          return;
        }
        this.drawError.set(null);
        this.ehldContainer().nativeElement.replaceChildren(svg);
        this.stIdToSVGGElement.set(this.ehldService.setStIdToSVGGElementMap(this.ehldContainer()));
        this.addEventListenerToSvg();
        this.initializePanAndZoom();
      }
    });
    // A file that fails to arrive must not leave the previous pathway's drawing
    // on screen under a message saying this one could not be loaded.
    effect(() => this.loadError() && untracked(() => this.clearDrawing()));
    // A message about one pathway's file says nothing about the next one's.
    effect(() => {
      this.pathwayId();
      untracked(() => this.drawError.set(null));
    });
    effect(() => {
      this.loadAnalysis();
      this.currentSample = this.state.sample() || undefined;
    });

    effect(() => {
      const request = this.download.downloadRequest();
      const options = request?.options || defaultDownloadOptions;
      // Read up front, not after the await below: a signal read after an await
      // runs outside the effect's tracking, so this one was never a dependency.
      const pathwayId = this.pathwayId();

      if (request && this.download.isRasterFormat(request.format)) {
        void this.ehldService
          .downloadImage(request.format)
          .then(() => this.download.resetDownload())
          .catch((error) => this.download.failed(error, 'EHLD image export failed'));
      } else if (request?.format === DownloadFormat.SVG) {
        void this.svgExporter
          .exportEHLD(this, options)
          .then((svg) => {
            this.download.export(svg, request.format, pathwayId);
            this.download.resetDownload();
          })
          .catch((error) => this.download.failed(error, 'EHLD SVG export failed'));
      }
    });
  }

  private clearDrawing(): void {
    this.panZoomInstance?.destroy();
    this.panZoomInstance = undefined;
    this.ehldContainer().nativeElement.replaceChildren();
    this.stIdToSVGGElement.set(new Map());
  }

  ngAfterViewInit(): void {
    this.style = new Style(this.ehldContainer().nativeElement);

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.panZoomInstance) return;
      this.handleResize();
    });

    this.resizeObserver.observe(this.ehldContainer().nativeElement);
  }

  legendPosition = signal<Point>({ x: 0, y: 0 });
  animateLegend = signal(false);

  toggleLegend(legendWidth: number) {
    this.animateLegend.set(true);
    this.legendPosition().x <= -legendWidth + 5
      ? this.legendPosition.set({
          x: 0,
          y: 0,
        })
      : this.legendPosition.set({ x: -legendWidth, y: 0 });
    setTimeout(() => this.animateLegend.set(false), 500);
  }

  // Example of zooming: https://stackblitz.com/edit/svg-pan-zoom?file=src%2Fapp%2Fapp.component.html,src%2Fapp%2Fapp.component.ts,src%2Fapp%2Fapp.module.ts
  // SVG pan zoom documentation: https://github.com/bumbu/svg-pan-zoom?tab=readme-ov-file
  initializePanAndZoom() {
    const svgElement = this.ehldContainer().nativeElement.querySelector('svg');
    if (svgElement) {
      // Disable default tooltips to be shown when hovering on svg element
      svgElement.querySelectorAll('title').forEach((item) => {
        item.innerHTML = '';
      });
      svgElement.setAttribute('width', '100%');
      svgElement.setAttribute('height', '100%');
      this.panZoomInstance = SvgPanZoom(svgElement, {
        zoomEnabled: true,
        controlIconsEnabled: false,
        dblClickZoomEnabled: false,
        panEnabled: true,
        fit: true,
        center: true,
        minZoom: this.controlMinZoom(),
        maxZoom: this.controlMaxZoom(),
        onZoom: (newScale) => {
          this.controlZoom.set(newScale);
        },
      });
      // initial default state
      this.initialZoom = this.panZoomInstance.getZoom();
      this.initialPan = this.panZoomInstance.getPan();
    }
  }

  private addEventListenerToSvg(): void {
    const svgElement = this.ehldContainer().nativeElement.querySelectorAll(
      'g[id^="REGION"]'
    ) as NodeListOf<SVGGElement>;

    svgElement.forEach((element: SVGGElement) => {
      element.addEventListener('mouseover', () => {
        if (element !== this.selectedElement()) {
          this.ehldService.applyShadow(element, this.flaggedElements());
          this.hovering.set(true);
        }
      });

      element.addEventListener('mouseout', () => {
        if (element !== this.selectedElement()) {
          this.ehldService.removeShadow(element, this.flaggedElements());
          this.hovering.set(false);
        }
      });

      element.addEventListener('click', () => {
        if (this.selectedElement()) {
          this.ehldService.removeOutline(this.selectedElement()!, this.flaggedElements());
        }
        this.selectedElement.set(element);

        const idAttr = this.selectedElement()?.getAttribute('id');
        if (idAttr) {
          const stId = this.ehldService.getStableId(idAttr);
          if (stId) this.state.select.set(stId);
        }

        this.ehldService.applyOutline(element, this.flaggedElements());
      });

      element.addEventListener('dblclick', () => {
        const idAttr = this.selectedElement()?.getAttribute('id');
        if (idAttr) {
          const stId = this.ehldService.getStableId(idAttr);
          if (stId) {
            // this.speciesService.setIgnore(false);
            this.pathwayId.set(stId);
          }
        }
      });
    });
  }

  private loadAnalysis() {
    const elementsMap = this.stIdToSVGGElement();
    const svg = this.ehldContainer().nativeElement.querySelector('svg')!;
    if (!svg) return;
    this.ehldService.clearExistingPatterns(svg);
    this.ehldService.clearAllOverlay(elementsMap);
    this.ehldService.clearAnalysisInfo(elementsMap);

    const bg = svg.querySelector('#BG') as SVGGElement;
    const fg = svg.querySelector('#FG') as SVGGElement;

    const allPathwayStIds = this.subpathwayStIds();
    if (!this.analysis.result()) {
      bg?.removeAttribute('style');
      fg?.removeAttribute('style');
    } else {
      if (bg) bg.style.filter = 'saturate(0)';
      if (fg) fg.style.filter = 'saturate(0)';

      allPathwayStIds.forEach((stId) => {
        const regionElement = elementsMap.get(stId);
        const pathwayData = this.analysis.pathwayStIdToData().get(stId);

        if (!regionElement) return;

        this.ehldService.createOverlay(stId, pathwayData, regionElement);
        this.ehldService.showAnalysisInfo(regionElement, pathwayData);
      });
    }
  }

  private handleResize() {
    if (!this.panZoomInstance) return;

    const rect = this.ehldContainer().nativeElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // skip updates if container width or height is 0.

    const zoom = this.panZoomInstance.getZoom();
    const pan = this.panZoomInstance.getPan();
    // detect if user has zoomed or panned
    const isDefaultView =
      Math.abs(zoom - this.initialZoom) < 0.01 &&
      Math.abs(pan.x - this.initialPan.x) < 1 &&
      Math.abs(pan.y - this.initialPan.y) < 1;
    // detect if user is zoomed all the way in
    const isZoomOut = Math.abs(zoom - 1) < 0.01;

    // only fit & center if user hasn’t interacted or zoom all the way in
    if (isDefaultView || isZoomOut) {
      this.panZoomInstance.resize();
      this.panZoomInstance.fit();
      this.panZoomInstance.center();

      this.initialZoom = this.panZoomInstance.getZoom();
      this.initialPan = this.panZoomInstance.getPan();
    }
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.panZoomInstance) {
      this.panZoomInstance.destroy();
    }
  }

  // needs Input event binding to react to mouse drag instead of mouse drop on slider
  zoom(inputEvent: Event) {
    const level = (inputEvent.target as HTMLInputElement).valueAsNumber;
    this.panZoomInstance?.zoom(level);
  }

  fitScreen() {
    this.panZoomInstance?.resize();
    this.panZoomInstance?.fit();
    this.panZoomInstance?.center();
  }

  move(direction: 'up' | 'right' | 'down' | 'left', distance = 50) {
    const x = direction === 'right' ? -distance : direction === 'left' ? distance : 0;
    const y = direction === 'up' ? distance : direction === 'down' ? -distance : 0;
    this.panZoomInstance?.panBy({ x, y });
  }
}
