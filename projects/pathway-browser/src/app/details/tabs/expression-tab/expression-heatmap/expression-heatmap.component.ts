import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { DarkService } from '../../../../services/dark.service';
import type {
  ExpressionHeatmapAnswer,
  ExpressionRow,
  Quantiles,
} from '../../../../model/expression.model';

/** Pixels per row and per tissue column. */
const ROW = 14;
const COLUMN = 18;

/** The legend's ticks, in TPM. */
const TICKS = [0, 1, 10, 100, 1000, 10000];

type Order = 'clustered' | 'name';

/** The cell under the pointer or the keyboard focus: a row and a tissue. */
interface GridCell {
  row: number;
  tissue: number;
}

/**
 * The Expression tab's heatmap (spec 024, FR-001 to FR-006, FR-014): the
 * selection's genes down, the experiment's tissues across, each cell shaded by
 * the gene's median TPM on a logarithmic scale. Drawn on a canvas, only the
 * rows in view: Signal Transduction has 2,763 genes, too many for an element
 * per cell. The cells take keyboard focus and say what they hold (FR-004).
 */
@Component({
  selector: 'cr-expression-heatmap',
  templateUrl: './expression-heatmap.component.html',
  styleUrl: './expression-heatmap.component.scss',
})
export class ExpressionHeatmapComponent implements OnDestroy {
  private readonly dark = inject(DarkService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly answer = input.required<ExpressionHeatmapAnswer>();

  readonly ROW = ROW;
  readonly COLUMN = COLUMN;
  readonly TICKS = TICKS;

  /** The server's order, genes expressed alike together, or by name (FR-006). */
  readonly order = linkedSignal<ExpressionHeatmapAnswer, Order>({
    source: this.answer,
    computation: () => 'clustered',
  });
  readonly tissues = computed(() => this.answer().experiment.tissues);
  readonly rows = computed<ExpressionRow[]>(() => {
    const rows = this.answer().rows;
    return this.order() === 'name'
      ? [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.gene.localeCompare(b.gene))
      : rows;
  });
  /** The top of the scale: the largest median shown, and never under 10 TPM. */
  readonly top = computed(() => {
    let top = 10;
    for (const row of this.answer().rows)
      for (const cell of row.values) if (cell && (cell[2] ?? 0) > top) top = cell[2] ?? top;
    return top;
  });
  readonly ticks = computed(() => TICKS.filter((tick) => tick <= this.top() * 1.5));

  readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** The first row in view, how far it is scrolled past, and how many fit. */
  readonly first = linkedSignal({ source: this.answer, computation: () => 0 });
  readonly offset = linkedSignal({ source: this.answer, computation: () => 0 });
  readonly visible = signal(30);
  readonly shownRows = computed(() =>
    this.rows()
      .slice(this.first(), this.first() + this.visible() + 1)
      .map((row, i) => ({ row, index: this.first() + i }))
  );

  readonly hovered = linkedSignal<ExpressionHeatmapAnswer, GridCell | null>({
    source: this.answer,
    computation: () => null,
  });
  readonly focused = linkedSignal<ExpressionHeatmapAnswer, GridCell | null>({
    source: this.answer,
    computation: () => null,
  });
  /** The cell the details describe: the pointer's, else the keyboard's. */
  readonly described = computed(() => this.hovered() ?? this.focused());
  readonly details = computed(() => {
    const cell = this.described();
    if (!cell) return null;
    const row = this.rows()[cell.row];
    const tissue = this.tissues()[cell.tissue];
    if (!row || !tissue) return null;
    return { row, tissue, values: row.values[cell.tissue] ?? null, cell };
  });

  private resize?: ResizeObserver;

  constructor() {
    // The scroller's height decides how many rows fit.
    afterRenderEffect(() => {
      const scroller = this.scroller().nativeElement;
      if (this.resize) return;
      this.resize = new ResizeObserver(() => {
        this.visible.set(Math.ceil(scroller.clientHeight / ROW) + 1);
      });
      this.resize.observe(scroller);
    });
    // Redraw on any change: rows, order, scroll, focus, or the theme, whose
    // colours the canvas reads from the page (FR-014).
    afterRenderEffect(() => {
      this.dark.isDark();
      this.draw(this.shownRows(), this.described());
    });
    // A new selection starts at the top (its order, focus and first row reset
    // with it, above).
    afterRenderEffect(() => {
      this.answer();
      this.scroller().nativeElement.scrollTop = 0;
    });
  }

  ngOnDestroy() {
    this.resize?.disconnect();
  }

  onScroll(event: Event) {
    const top = (event.target as HTMLElement).scrollTop;
    this.first.set(Math.max(0, Math.floor(top / ROW)));
    this.offset.set(top % ROW);
  }

  /** The cell at a pointer position over the canvas, if any. */
  private cellAt(event: MouseEvent): GridCell | null {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    const tissue = Math.floor((event.clientX - rect.left) / COLUMN);
    const row = this.first() + Math.floor((event.clientY - rect.top + this.offset()) / ROW);
    return tissue >= 0 && tissue < this.tissues().length && row >= 0 && row < this.rows().length
      ? { row, tissue }
      : null;
  }

  onPointer(event: MouseEvent) {
    this.hovered.set(this.cellAt(event));
  }

  /** Arrow keys move the focus; Home and End go to a row's ends (FR-004). */
  onKey(event: KeyboardEvent) {
    const cell = this.focused() ?? { row: this.first(), tissue: 0 };
    const last = { row: this.rows().length - 1, tissue: this.tissues().length - 1 };
    const moves: Record<string, GridCell> = {
      ArrowUp: { ...cell, row: Math.max(0, cell.row - 1) },
      ArrowDown: { ...cell, row: Math.min(last.row, cell.row + 1) },
      ArrowLeft: { ...cell, tissue: Math.max(0, cell.tissue - 1) },
      ArrowRight: { ...cell, tissue: Math.min(last.tissue, cell.tissue + 1) },
      Home: { ...cell, tissue: 0 },
      End: { ...cell, tissue: last.tissue },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    this.focused.set(next);
    this.hovered.set(null);
    // Keep the focused row in view.
    const scroller = this.scroller().nativeElement;
    const y = next.row * ROW;
    if (y < scroller.scrollTop) scroller.scrollTop = y;
    else if (y + ROW > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = y + ROW - scroller.clientHeight;
  }

  onFocus() {
    if (!this.focused()) this.focused.set({ row: this.first(), tissue: 0 });
  }

  /** How a value reads in the details: whole numbers above 10, else two figures. */
  format(value: number | undefined): string {
    if (value === undefined) return '';
    if (value >= 10) return Math.round(value).toLocaleString();
    return value.toPrecision(2).replace(/\.?0+$/, '');
  }

  /** The scale position of a median: log10(m + 1) against the top's. */
  position(median: number): number {
    return Math.log10(median + 1) / Math.log10(this.top() + 1);
  }

  /** The legend's gradient, from the same colours the cells use. */
  readonly legendGradient = computed(() => {
    this.dark.isDark();
    const [low, high] = [this.colour('--surface-variant'), this.colour('--primary')];
    return `linear-gradient(to right, ${low}, ${high})`;
  });

  private colour(token: string): string {
    const value = getComputedStyle(this.host.nativeElement).getPropertyValue(token).trim();
    return value || (token === '--primary' ? '#1a5fb4' : '#888');
  }

  /** A CSS colour as red, green and blue, read back from a canvas. */
  private rgb(context: CanvasRenderingContext2D, css: string): [number, number, number] {
    context.fillStyle = '#000';
    context.fillStyle = css;
    const hex = String(context.fillStyle);
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
    if (match)
      return [1, 2, 3].map((i) => parseInt(match[i] ?? '0', 16)) as [number, number, number];
    const parts = /rgba?\(([^)]+)\)/.exec(hex)?.[1]?.split(',').map(Number) ?? [0, 0, 0];
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }

  private draw(shown: { row: ExpressionRow; index: number }[], described: GridCell | null) {
    const canvas = this.canvas().nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    const scroller = this.scroller().nativeElement;
    const ratio = window.devicePixelRatio || 1;
    const width = this.tissues().length * COLUMN;
    const height = Math.max(ROW, scroller.clientHeight);
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const low = this.rgb(context, this.colour('--surface-variant'));
    const high = this.rgb(context, this.colour('--primary'));
    const none = this.colour('--surface');
    const line = this.colour('--outline-variant');
    const offset = this.offset();

    for (const { row, index } of shown) {
      const y = (index - this.first()) * ROW - offset;
      row.values.forEach((cell: Quantiles | null, t: number) => {
        const x = t * COLUMN;
        if (!cell) {
          // No value: the background, crossed, never a shade of "low".
          context.fillStyle = none;
          context.fillRect(x, y, COLUMN - 1, ROW - 1);
          context.strokeStyle = line;
          context.beginPath();
          context.moveTo(x + 2, y + ROW - 3);
          context.lineTo(x + COLUMN - 3, y + 2);
          context.stroke();
          return;
        }
        const median = cell[2] ?? 0;
        if (median <= 0) {
          // Not expressed: its own shade, the scale's start without colour.
          context.fillStyle = none;
          context.fillRect(x, y, COLUMN - 1, ROW - 1);
          context.strokeStyle = line;
          context.strokeRect(x + 0.5, y + 0.5, COLUMN - 2, ROW - 2);
          return;
        }
        const p = Math.min(1, this.position(median));
        const mix = (i: number) => Math.round((low[i] ?? 0) + ((high[i] ?? 0) - (low[i] ?? 0)) * p);
        context.fillStyle = `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
        context.fillRect(x, y, COLUMN - 1, ROW - 1);
      });
    }
    if (described) {
      const y = (described.row - this.first()) * ROW - offset;
      context.strokeStyle = this.colour('--on-surface');
      context.lineWidth = 2;
      context.strokeRect(described.tissue * COLUMN + 1, y + 1, COLUMN - 3, ROW - 3);
      context.lineWidth = 1;
    }
  }
}
