import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import cytoscape, { Core, ElementDefinition, StylesheetJson } from 'cytoscape';
import chroma from 'chroma-js';
import { DeltaSignalService } from './deltasignal.service';
import { buildLogicGraph, DeltaSignalLogicGraphNode } from './deltasignal.utils';

const GRAPH_LIMIT = 40;

@Component({
  selector: 'cr-deltasignal-logic-graph',
  templateUrl: './deltasignal-logic-graph.component.html',
  styleUrl: './deltasignal-logic-graph.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIcon, MatIconButton, MatTooltip],
})
export class DeltaSignalLogicGraphComponent implements OnDestroy {
  private readonly service = inject(DeltaSignalService);
  private readonly zone = inject(NgZone);
  private readonly container = viewChild<ElementRef<HTMLDivElement>>('graphContainer');
  private cy?: Core;
  private observedElement?: HTMLDivElement;

  readonly subgraph = computed(() =>
    buildLogicGraph(this.service.network(), this.service.rows(), GRAPH_LIMIT)
  );
  readonly selected = signal<DeltaSignalLogicGraphNode | null>(null);

  private readonly resizeObserver = new ResizeObserver(() => {
    this.cy?.resize();
    this.cy?.fit(undefined, 28);
  });

  constructor() {
    effect(() => {
      const container = this.container()?.nativeElement;
      const graph = this.subgraph();
      const palette = this.service.palette();
      if (!container) return;
      untracked(() => this.render(container, graph.nodes, graph.edges, palette));
    });
  }

  fit() {
    this.cy?.fit(undefined, 28);
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
    this.cy?.destroy();
  }

  private render(
    container: HTMLDivElement,
    nodes: DeltaSignalLogicGraphNode[],
    edges: ReturnType<typeof buildLogicGraph>['edges'],
    palette: ReturnType<DeltaSignalService['palette']>
  ) {
    this.cy?.destroy();
    if (this.observedElement !== container) {
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(container);
      this.observedElement = container;
    }

    const maxInfluence = Math.max(1, ...nodes.map((node) => Math.abs(node.influence)));
    const graphElements: ElementDefinition[] = [
      ...nodes.map((node) => {
        const fill = palette(node.change).hex();
        return {
          group: 'nodes' as const,
          classes: `${nodeClass(node.entityType)}${node.perturbed ? ' perturbed' : ''}`,
          data: {
            id: node.uuid,
            label: compactLabel(node.name),
            color: fill,
            labelColor: chroma(fill).get('oklch.l') > 0.68 ? '#172126' : '#ffffff',
            size: 42 + 26 * Math.sqrt(Math.abs(node.influence) / maxInfluence),
          },
        };
      }),
      ...edges.map((edge, index) => ({
        group: 'edges' as const,
        classes: `${edge.is_positive ? 'positive' : 'negative'} ${edge.is_and ? 'and' : 'or'}`,
        data: {
          id: `edge-${index}-${edge.parent_uuid}-${edge.child_uuid}`,
          source: edge.parent_uuid,
          target: edge.child_uuid,
          edgeType: edge.edge_type,
        },
      })),
    ];

    this.cy = cytoscape({
      container,
      elements: graphElements,
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      style: logicGraphStyles,
    });
    this.cy.on('tap', 'node', (event) => {
      const selected = nodes.find((node) => node.uuid === event.target.id()) ?? null;
      this.zone.run(() => this.selected.set(selected));
    });
    this.cy
      .layout({
        name: 'cose',
        animate: false,
        fit: true,
        padding: 36,
        nodeRepulsion: 7000,
        idealEdgeLength: 90,
      })
      .run();

    const initial = nodes.find((node) => node.perturbed) ?? nodes[0] ?? null;
    this.selected.set(initial);
    if (initial) this.cy.getElementById(initial.uuid).select();
  }
}

const logicGraphStyles: StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'border-color': '#0b7285',
      'border-width': 1.5,
      color: 'data(labelColor)',
      height: 'data(size)',
      label: 'data(label)',
      shape: 'ellipse',
      'font-size': 10,
      'font-weight': 600,
      'min-zoomed-font-size': 7,
      'text-halign': 'center',
      'text-valign': 'center',
      'text-max-width': '74px',
      'text-wrap': 'ellipsis',
      width: 'data(size)',
    },
  },
  {
    selector: 'node.perturbed',
    style: {
      'border-color': '#e89b1d',
      'border-width': 5,
    },
  },
  {
    selector: 'node.reaction',
    style: { shape: 'diamond' },
  },
  {
    selector: 'node.complex',
    style: { shape: 'round-rectangle' },
  },
  {
    selector: 'node.sequence',
    style: { shape: 'hexagon' },
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#11181c',
      'border-width': 4,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'line-color': '#1b7f8c',
      'line-style': 'solid',
      opacity: 0.72,
      'target-arrow-color': '#1b7f8c',
      'target-arrow-shape': 'triangle',
      width: 2,
    },
  },
  {
    selector: 'edge.negative',
    style: {
      'line-color': '#a23b72',
      'target-arrow-color': '#a23b72',
    },
  },
  {
    selector: 'edge.or',
    style: { 'line-style': 'dashed' },
  },
];

function compactLabel(name: string): string {
  const compartment = name.indexOf(' [');
  return (compartment >= 0 ? name.slice(0, compartment) : name).slice(0, 42);
}

function nodeClass(entityType: string): string {
  const normalized = entityType.toLowerCase();
  if (normalized.includes('reaction')) return 'reaction';
  if (normalized.includes('complex') || normalized.includes('set')) return 'complex';
  if (normalized.includes('rna') || normalized.includes('dna')) return 'sequence';
  return 'entity';
}
