import { HttpClient } from '@angular/common/http';
import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import type { ExpressionHeatmapAnswer, ExpressionRow } from '../../../../model/expression.model';
import { DarkService } from '../../../../services/dark.service';
import { shade, tokenRgb, topOf } from '../expression-heatmap/expression-scale';

/**
 * The figures shipped for each species (assets/anatomogram), by file prefix:
 * a species with one figure has '' (bos_taurus.svg), with several their names
 * (homo_sapiens.male.svg).
 */
const FIGURES: Record<string, Figure[]> = {
  homo_sapiens: ['male', 'female', 'brain'],
  mus_musculus: ['male', 'female', 'brain'],
  bos_taurus: [''],
};

type Figure = 'male' | 'female' | 'brain' | '';

/**
 * Expression Atlas's anatomogram beside the heatmap (spec 024, FR-015 to
 * FR-017): the species' figure, each of the experiment's tissues matched to
 * its organ by its UBERON id. With a gene pointed at on the heatmap, its
 * organs are shaded on the heatmap's own scale; pointing at an organ picks
 * out its tissue's column. Drawn inline from the shipped SVG and coloured
 * from the theme, so it follows dark mode as the widget never did.
 */
@Component({
  selector: 'cr-expression-anatomogram',
  templateUrl: './expression-anatomogram.component.html',
  styleUrl: './expression-anatomogram.component.scss',
  // The figure's nodes are inserted by hand, so the styles reach them unscoped
  // (every selector in the stylesheet starts with this component's tag).
  encapsulation: ViewEncapsulation.None,
})
export class ExpressionAnatomogramComponent {
  private readonly http = inject(HttpClient);
  private readonly dark = inject(DarkService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly answer = input.required<ExpressionHeatmapAnswer>();
  /** The gene pointed at or focused on the heatmap, if any. */
  readonly row = input<ExpressionRow | null>(null);
  /** The tissue pointed at on the heatmap, if any. */
  readonly tissue = input<number | null>(null);
  /** The tissue whose organ is pointed at here, for the heatmap (FR-016). */
  readonly pointedTissue = output<number | null>();

  readonly prefix = computed(() =>
    this.answer().experiment.species.toLowerCase().replace(/ /g, '_')
  );
  readonly figures = computed(() => FIGURES[this.prefix()] ?? []);
  /** The figure shown: the species' first, until the reader chooses another. */
  readonly figure = linkedSignal<Figure[], Figure>({
    source: this.figures,
    computation: (figures) => figures[0] ?? '',
  });
  readonly organName = signal<string | null>(null);

  readonly svg = rxResource({
    params: () =>
      this.figures().includes(this.figure())
        ? `assets/anatomogram/${this.prefix()}${this.figure() ? `.${this.figure()}` : ''}.svg`
        : undefined,
    stream: ({ params }) => (params ? this.http.get(params, { responseType: 'text' }) : of('')),
  });

  readonly container = viewChild<ElementRef<HTMLElement>>('figureHost');

  /** Each tissue's organ elements in the figure shown, by tissue index. */
  private organs = new Map<number, Element[]>();
  private readonly tissueByUberon = computed(
    () => new Map(this.answer().experiment.tissues.map((tissue, i) => [tissue.uberon, i]))
  );

  constructor() {
    // Put a newly loaded figure in place, and find the experiment's organs in it.
    afterRenderEffect(() => {
      const text = this.svg.hasValue() ? this.svg.value() : '';
      const container = this.container()?.nativeElement;
      if (!container) return;
      container.replaceChildren();
      this.organs = new Map();
      if (!text) return;
      const parsed = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      if (parsed.nodeName !== 'svg') return;
      container.appendChild(document.importNode(parsed, true));
      const byUberon = this.tissueByUberon();
      for (const element of Array.from(container.querySelectorAll('[id^="UBERON_"]'))) {
        const index = byUberon.get(element.id);
        if (index === undefined) continue;
        this.organs.set(index, [...(this.organs.get(index) ?? []), element]);
      }
      // Painted once in place, untracked: tracked, this effect read the gene
      // and tissue through paint(), and every move over the heatmap parsed
      // and inserted the figure again (85 ms for the male one).
      untracked(() => this.paint());
    });
    // Shade again when the gene, the tissue or the theme changes.
    afterRenderEffect(() => {
      this.row();
      this.tissue();
      this.dark.isDark();
      this.paint();
    });
  }

  /** Colour each matched organ: the gene's median, else the theme's "measured" shade. */
  private paint() {
    const host = this.host.nativeElement;
    const low = tokenRgb(host, '--surface-variant', [136, 136, 136]);
    const high = tokenRgb(host, '--primary', [26, 95, 180]);
    const outline = `rgb(${tokenRgb(host, '--on-surface', [0, 0, 0]).join(', ')})`;
    const top = topOf(this.answer().rows);
    const row = this.row();
    const picked = this.tissue();
    for (const [index, elements] of this.organs) {
      const median = row?.values[index]?.[2];
      // No value: the heatmap's "no value" background, not a hole in the figure.
      const fill = row
        ? median !== undefined
          ? shade(median, top, low, high)
          : `rgb(${tokenRgb(host, '--surface', [255, 255, 255]).join(', ')})`
        : '';
      for (const element of elements) {
        for (const shape of [element, ...Array.from(element.querySelectorAll('*'))]) {
          const style = (shape as SVGElement).style;
          if (fill) style.setProperty('fill', fill, 'important');
          else style.removeProperty('fill');
          if (index === picked) {
            style.setProperty('stroke', outline, 'important');
            style.setProperty('stroke-width', '1', 'important');
          } else {
            style.removeProperty('stroke');
            style.removeProperty('stroke-width');
          }
        }
        element.classList.add('measured');
      }
    }
  }

  /** The tissue whose organ is under the pointer, if any. */
  private tissueAt(target: EventTarget | null): number | null {
    let element = target instanceof Element ? target : null;
    while (element && element !== this.container()?.nativeElement) {
      const index = element.id ? this.tissueByUberon().get(element.id) : undefined;
      if (index !== undefined) return index;
      element = element.parentElement;
    }
    return null;
  }

  onPointer(event: MouseEvent) {
    const index = this.tissueAt(event.target);
    this.organName.set(
      index === null ? null : (this.answer().experiment.tissues[index]?.label ?? null)
    );
    this.pointedTissue.emit(index);
  }

  onLeave() {
    this.organName.set(null);
    this.pointedTissue.emit(null);
  }
}
