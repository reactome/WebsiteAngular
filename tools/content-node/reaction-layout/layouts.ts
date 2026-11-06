/**
 * reaction-exporter's Div and its glyph layouts (research D22, step 3): a
 * row or a column of glyphs in one cell of the BOX algorithm's grid. A layout
 * sizes its glyphs (Transformer.setSize) and arranges them the first time
 * its bounds are asked for, and keeps those bounds after: the reaction's
 * backbone is appended then, once.
 */
import { Bounds } from './bounds.ts';
import type { CompartmentGlyph, EntityGlyph, EntityRole } from './model.ts';
import { placeOf } from './place.ts';
import type { Place } from './place.ts';
import { boundsOf, center, move, setSize } from './transformer.ts';
import type { PlacedGlyph } from './transformer.ts';

/** A cell of the grid: a compartment's box, or a layout of glyphs. */
export interface Div {
  readonly kind: 'box' | 'horizontal' | 'vertical';
  /** A box's is null. */
  bounds(): Bounds | null;
  center(x: number, y: number): void;
  containedRoles(): Set<EntityRole>;
  busyPlaces(): Set<Place>;
  compartment(): CompartmentGlyph | undefined;
}

export abstract class GlyphsLayout implements Div {
  abstract readonly kind: 'horizontal' | 'vertical';
  readonly glyphs: PlacedGlyph[];
  leftPadding = 10;
  rightPadding = 10;
  topPadding = 10;
  bottomPadding = 10;
  readonly separation = 5;
  #bounds: Bounds | undefined;

  constructor(glyphs: PlacedGlyph[]) {
    this.glyphs = glyphs;
  }

  bounds(): Bounds {
    this.#bounds ??= this.layout();
    return this.#bounds;
  }

  setHorizontalPadding(padding: number) {
    this.leftPadding = this.rightPadding = padding;
  }

  setVerticalPadding(padding: number) {
    this.topPadding = this.bottomPadding = padding;
  }

  center(x: number, y: number) {
    const bounds = this.bounds();
    this.move(x - bounds.cx, y - bounds.cy);
  }

  move(dx: number, dy: number) {
    const bounds = this.bounds();
    for (const glyph of this.glyphs) move(glyph, { x: dx, y: dy });
    bounds.move(dx, dy);
  }

  containedRoles(): Set<EntityRole> {
    const roles = new Set<EntityRole>();
    for (const glyph of this.glyphs)
      if (glyph.kind === 'entity') for (const role of glyph.roles) roles.add(role.type);
    return roles;
  }

  busyPlaces(): Set<Place> {
    const [first] = this.glyphs;
    if (first?.kind === 'reaction') return new Set(['CENTER']);
    const places = new Set<Place>();
    for (const glyph of this.glyphs) {
      // A cast to EntityGlyph: only a reaction alone is not one.
      if (glyph.kind !== 'entity') throw new Error('ClassCastException: ReactionGlyph');
      for (const role of glyph.roles) places.add(placeOf(role.type));
    }
    return places;
  }

  compartment(): CompartmentGlyph | undefined {
    const [first] = this.glyphs;
    return first?.compartment;
  }

  protected abstract layout(): Bounds;
}

export class HorizontalLayout extends GlyphsLayout {
  readonly kind = 'horizontal';

  protected layout(): Bounds {
    if (!this.glyphs.length)
      return Bounds.of(
        0,
        0,
        this.leftPadding + this.rightPadding,
        this.topPadding + this.bottomPadding
      );
    for (const glyph of this.glyphs) setSize(glyph);
    const height = maxOf(this.glyphs.map((glyph) => boundsOf(glyph).height));
    const cy = 0.5 * height + this.topPadding;
    let x = this.leftPadding;
    for (const glyph of this.glyphs) {
      const width = boundsOf(glyph).width;
      const cx = x + 0.5 * width;
      center(glyph, { x: cx, y: cy });
      x += this.separation + width;
    }
    return Bounds.of(
      0,
      0,
      x - this.separation + this.rightPadding,
      height + this.bottomPadding + this.topPadding
    );
  }
}

export class VerticalLayout extends GlyphsLayout {
  readonly kind = 'vertical';

  protected layout(): Bounds {
    if (!this.glyphs.length)
      return Bounds.of(
        0,
        0,
        this.leftPadding + this.rightPadding,
        this.topPadding + this.bottomPadding
      );
    for (const glyph of this.glyphs) setSize(glyph);
    if (this.glyphs.length > 6) return this.twoColumns();
    // Two catalysts among the inputs, common in diseases: two columns too.
    const catalysts = this.glyphs.filter((glyph) =>
      (glyph as EntityGlyph).roles.some((role) => role.type === 'catalyst')
    ).length;
    if (catalysts > 1) return this.twoColumns();
    const width = maxOf(this.glyphs.map((glyph) => boundsOf(glyph).width));
    const cx = this.leftPadding + 0.5 * width;
    let y = this.topPadding;
    for (const glyph of this.glyphs) {
      const height = boundsOf(glyph).height;
      const cy = y + 0.5 * height;
      center(glyph, { x: cx, y: cy });
      y += this.separation + height;
    }
    return Bounds.of(
      0,
      0,
      width + this.leftPadding + this.rightPadding,
      y - this.separation + this.bottomPadding
    );
  }

  /**
   * layoutInTwoColumns: alternating between two columns 30 apart, each
   * glyph a step below the last; no padding, and bounds that start from the
   * origin, as Java's empty Bounds does.
   */
  private twoColumns(): Bounds {
    const widths = [0, 0];
    this.glyphs.forEach((glyph, i) => {
      const width = boundsOf(glyph).width;
      const j = i % 2;
      if (width > (widths[j] as number)) widths[j] = width;
    });
    const [w0, w1] = widths as [number, number];
    const xs = [0.5 * w0, 0];
    xs[1] = (xs[0] as number) + 0.5 * w0 + 0.5 * w1 + 30;
    const height = maxOf(this.glyphs.map((glyph) => boundsOf(glyph).height));
    // Room for the stoichiometry.
    const step = 0.5 * (height + Math.max(this.separation, 16));
    const limits = new Bounds();
    let y = 0;
    this.glyphs.forEach((glyph, i) => {
      y += step;
      center(glyph, { x: xs[i % 2] as number, y });
      limits.union(boundsOf(glyph));
    });
    return limits;
  }
}

/** DoubleStream.max().orElse(0), for the sizes here (never NaN or -0). */
function maxOf(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}
