/**
 * Step 3 of the reaction layout (research D22): reaction-exporter's
 * BoxAlgorithm.compute, as ContentService runs it. A box per compartment
 * gives every participant a cell of one grid; the grid is compacted; rows and
 * columns are sized from what they hold; everything is centred in its cell
 * and wired to the reaction (connectors.ts); then each compartment is drawn
 * round what it holds, and the whole moved to the origin.
 */
import { Bounds } from './bounds.ts';
import { Box } from './box.ts';
import type { Point } from './box.ts';
import { addConnectors } from './connectors.ts';
import { Grid } from './grid.ts';
import { removeExtracellular } from './inputs.ts';
import type { Inputs } from './inputs.ts';
import { GlyphsLayout, HorizontalLayout, VerticalLayout } from './layouts.ts';
import type { Div } from './layouts.ts';
import { LayoutIndex } from './layout-index.ts';
import { JavaNullPointerException, checkIndex } from './model.ts';
import type { CompartmentGlyph, EntityRole } from './model.ts';
import { simplify } from './place.ts';
import type { Place } from './place.ts';
import { textWidth } from './text.ts';
import { LINE_HEIGHT } from './text-widths.ts';
import { boundsOf, moveCompartment, padded } from './transformer.ts';

const COMPARTMENT_PADDING = 20;
const VERTICAL_PADDING = 40;
const HORIZONTAL_PADDING = 75;
const INTEGER_MAX = 2147483647;

/** The laid-out inputs: Layout's bounds, which the diagram's limits come from. */
export interface Laid extends Inputs {
  bounds: Bounds;
}

/** BoxAlgorithm.compute: places, sizes and wires everything in `inputs`, in place. */
export function layOut(inputs: Inputs): Laid {
  // The index is made in BoxAlgorithm's constructor; the fixes after it
  // (inputs.ts) change no role, so it is the same made here.
  const index = new LayoutIndex(inputs);
  const root = inputs.root;

  // 1. Positioning.
  const box = new Box(root, index);
  const placed = box.placeReaction();
  if (!placed) throw new JavaNullPointerException();
  box.placeElements(placed);

  // 2. Compaction.
  const grid = Grid.of(box.divs());
  removeEmptyRows(grid);
  removeEmptyCols(grid);
  expandSameRoleSameColumn(grid, reactionPosition(grid));
  expandSameRoleSameRow(grid, reactionPosition(grid));
  let position = reactionPosition(grid);
  forceDiagonalTopDown(grid, position);
  forceDiagonalLeftRight(grid, position);
  position = reactionPosition(grid);
  const fits = (g: Grid<Div>, source: Point, target: Point) => canMove(root, g, source, target);
  compactLeft(grid, position, fits);
  compactRight(grid, position, fits);
  compactTop(grid, position, fits);
  compactBottom(grid, position, fits);
  removeEmptyRows(grid);
  removeEmptyCols(grid);

  // 3. Sizing: each row's height and column's width, and where in it its content sits.
  const heights = new Array<number>(grid.rows).fill(0);
  const verticalPadding = new Array<number>(grid.rows).fill(0);
  const widths = new Array<number>(grid.columns).fill(0);
  const horizontalPadding = new Array<number>(grid.columns).fill(0);
  size(root, grid, heights, widths, horizontalPadding, verticalPadding);

  // Extra room round the reaction: above it for the nearest catalysts, below
  // for the nearest regulators, either side for the nearest inputs and outputs.
  position = reactionPosition(grid);
  for (let r = position.row - 1; r >= 0; r -= 1)
    if (containsRole(grid.getRow(r), ['catalyst'])) {
      heights[r] = (heights[r] as number) + VERTICAL_PADDING;
      verticalPadding[r] = (verticalPadding[r] as number) - VERTICAL_PADDING;
      break;
    }
  for (let r = position.row + 1; r < grid.rows; r += 1)
    if (containsRole(grid.getRow(r), ['negative', 'positive'])) {
      heights[r] = (heights[r] as number) + VERTICAL_PADDING;
      verticalPadding[r] = (verticalPadding[r] as number) + VERTICAL_PADDING;
      break;
    }
  for (let c = position.col - 1; c >= 0; c -= 1)
    if (containsRole(grid.getColumn(c), ['input'])) {
      widths[c] = (widths[c] as number) + HORIZONTAL_PADDING;
      horizontalPadding[c] = (horizontalPadding[c] as number) - HORIZONTAL_PADDING;
      break;
    }
  for (let c = position.col + 1; c < grid.columns; c += 1)
    if (containsRole(grid.getColumn(c), ['output'])) {
      widths[c] = (widths[c] as number) + HORIZONTAL_PADDING;
      horizontalPadding[c] = (horizontalPadding[c] as number) + HORIZONTAL_PADDING;
      break;
    }

  // Everything centred in its cell.
  const cy = centers(heights, verticalPadding);
  const cx = centers(widths, horizontalPadding);
  for (let row = 0; row < grid.rows; row += 1)
    for (let col = 0; col < grid.columns; col += 1)
      grid.get(row, col)?.center(cx[col] as number, cy[row] as number);

  // 4. Connectors.
  addConnectors(position, grid, widths, heights, inputs.reaction, index);

  layoutCompartment(root);
  removeExtracellular(inputs);
  const bounds = dimension(inputs);
  // moveToOrigin.
  const delta = { x: -bounds.x, y: -bounds.y };
  bounds.move(delta.x, delta.y);
  moveCompartment(root, delta, true);
  return Object.assign(inputs, { bounds });
}

/** getCenters: each row's or column's centre, from the sizes before it and its padding. */
function centers(sizes: number[], paddings: number[]): number[] {
  return sizes.map((own, i) => {
    let centre = 0;
    for (let j = 0; j < i; j += 1) centre += sizes[j] as number;
    centre += 0.5 * ((paddings[i] as number) + own);
    return centre;
  });
}

/** getReactionPosition: the cell holding the reaction's layout. Java's null, met at once, is a NullPointerException. */
function reactionPosition(grid: Grid<Div>): Point {
  for (let r = 0; r < grid.rows; r += 1)
    for (let c = 0; c < grid.columns; c += 1) {
      const div = grid.get(r, c);
      if (div instanceof GlyphsLayout && div.glyphs[0]?.kind === 'reaction')
        return { row: r, col: c };
    }
  throw new JavaNullPointerException();
}

const hasPlace = (divs: (Div | null)[] | null, place: Place) =>
  (divs ?? []).some((div) => div?.busyPlaces().has(place));

type Fits = (grid: Grid<Div>, source: Point, target: Point) => boolean;

/** compactLeft: inputs and what is left of the reaction moved a column right, while they can. */
function compactLeft(grid: Grid<Div>, reaction: Point, fits: Fits) {
  let moved: boolean;
  do {
    moved = false;
    for (let col = reaction.col - 1; col >= 0; col -= 1) {
      const to = col + 1;
      for (let row = 0; row < grid.rows; row += 1) {
        const div = grid.get(row, col);
        if (div === null || grid.get(row, to) !== null) continue;
        const places = div.busyPlaces();
        // Inputs share no column with the reaction, or with catalysts or regulators.
        if (places.has('LEFT') && to === reaction.col) continue;
        const column = grid.getColumn(to);
        if (places.has('LEFT') && (hasPlace(column, 'TOP') || hasPlace(column, 'BOTTOM'))) continue;
        // Nor two catalysts, nor two regulators.
        if (places.has('TOP') && hasPlace(column, 'TOP')) continue;
        if (places.has('BOTTOM') && hasPlace(column, 'BOTTOM')) continue;
        if (fits(grid, { row, col }, { row, col: to })) {
          grid.set(row, to, div);
          grid.set(row, col, null);
          moved = true;
        }
      }
    }
  } while (moved);
}

function compactRight(grid: Grid<Div>, reaction: Point, fits: Fits) {
  let moved: boolean;
  do {
    moved = false;
    for (let c = reaction.col + 1; c < grid.columns; c += 1) {
      const to = c - 1;
      for (let r = 0; r < grid.rows; r += 1) {
        const div = grid.get(r, c);
        if (div === null || grid.get(r, to) !== null) continue;
        const places = div.busyPlaces();
        if (places.has('RIGHT') && reaction.col === to) continue;
        const column = grid.getColumn(to);
        if (places.has('RIGHT') && (hasPlace(column, 'TOP') || hasPlace(column, 'BOTTOM')))
          continue;
        if (places.has('TOP') && hasPlace(column, 'TOP')) continue;
        if (places.has('BOTTOM') && hasPlace(column, 'BOTTOM')) continue;
        if (fits(grid, { row: r, col: c }, { row: r, col: to })) {
          grid.set(r, to, div);
          grid.set(r, c, null);
          moved = true;
        }
      }
    }
  } while (moved);
}

function compactTop(grid: Grid<Div>, reaction: Point, fits: Fits) {
  let moved: boolean;
  do {
    moved = false;
    for (let r = reaction.row - 1; r >= 0; r -= 1) {
      const to = r + 1;
      for (let c = 0; c < grid.columns; c += 1) {
        const div = grid.get(r, c);
        if (div === null || grid.get(to, c) !== null) continue;
        const places = div.busyPlaces();
        if (places.has('TOP') && reaction.row === to) continue;
        const row = grid.getRow(to);
        if (places.has('TOP') && (hasPlace(row, 'LEFT') || hasPlace(row, 'RIGHT'))) continue;
        if (places.has('LEFT') && hasPlace(row, 'LEFT')) continue;
        if (places.has('RIGHT') && hasPlace(row, 'RIGHT')) continue;
        if (fits(grid, { row: r, col: c }, { row: to, col: c })) {
          grid.set(to, c, div);
          grid.set(r, c, null);
          moved = true;
        }
      }
    }
  } while (moved);
}

function compactBottom(grid: Grid<Div>, reaction: Point, fits: Fits) {
  let moved: boolean;
  do {
    moved = false;
    for (let r = reaction.row + 1; r < grid.rows; r += 1) {
      const to = r - 1;
      for (let c = 0; c < grid.columns; c += 1) {
        const div = grid.get(r, c);
        if (div === null || grid.get(to, c) !== null) continue;
        const places = div.busyPlaces();
        if (places.has('BOTTOM') && reaction.row === to) continue;
        const row = grid.getRow(to);
        if (places.has('BOTTOM') && (hasPlace(row, 'LEFT') || hasPlace(row, 'RIGHT'))) continue;
        if (places.has('LEFT') && hasPlace(row, 'LEFT')) continue;
        if (places.has('RIGHT') && hasPlace(row, 'RIGHT')) continue;
        if (fits(grid, { row: r, col: c }, { row: to, col: c })) {
          grid.set(to, c, div);
          grid.set(r, c, null);
          moved = true;
        }
      }
    }
  } while (moved);
}

/** canMove: whether, moved, every div still falls in its own compartment's cells. */
function canMove(root: CompartmentGlyph, grid: Grid<Div>, source: Point, target: Point): boolean {
  if (grid.get(target.row, target.col) !== null) return false;
  const copy = grid.copy();
  copy.set(target.row, target.col, grid.get(source.row, source.col));
  copy.set(source.row, source.col, null);
  const compartments = new Grid<CompartmentGlyph>(grid.rows, grid.columns);
  if (!computeCompartment(root, copy, compartments)) return false;
  for (let r = 0; r < copy.rows; r += 1)
    for (let c = 0; c < copy.columns; c += 1) {
      const div = copy.get(r, c);
      if (div !== null && div.compartment() !== (compartments.get(r, c) ?? undefined)) return false;
    }
  return true;
}

/** isAncestor: whether `parent` is above `child` in the compartment tree. */
function isAncestor(parent: CompartmentGlyph | undefined, child: CompartmentGlyph | undefined) {
  if (!parent || !child) return false;
  for (let ancestor = child.parent; ancestor; ancestor = ancestor.parent)
    if (ancestor === parent) return true;
  return false;
}

/** The cells a compartment spans: those of its divs and its children's. */
function span(
  compartment: CompartmentGlyph,
  grid: Grid<Div>,
  visit?: (div: Div, r: number, c: number) => void
) {
  let minCol = INTEGER_MAX;
  let maxCol = 0;
  let minRow = INTEGER_MAX;
  let maxRow = 0;
  for (let r = 0; r < grid.rows; r += 1)
    for (let c = 0; c < grid.columns; c += 1) {
      const div = grid.get(r, c);
      if (div === null) continue;
      const own = div.compartment();
      if (compartment === own || isAncestor(compartment, own)) {
        minCol = Math.min(minCol, c);
        maxCol = Math.max(maxCol, c);
        minRow = Math.min(minRow, r);
        maxRow = Math.max(maxRow, r);
        visit?.(div, r, c);
      }
    }
  return { minCol, maxCol, minRow, maxRow };
}

/** computeCompartment: marks each compartment's cells, children first; false where they would overlap wrongly. */
function computeCompartment(
  compartment: CompartmentGlyph,
  grid: Grid<Div>,
  compartments: Grid<CompartmentGlyph>
): boolean {
  for (const child of compartment.children)
    if (!computeCompartment(child, grid, compartments)) return false;
  const { minCol, maxCol, minRow, maxRow } = span(compartment, grid);
  for (let r = minRow; r <= maxRow; r += 1)
    for (let c = minCol; c <= maxCol; c += 1) {
      const there = compartments.get(r, c);
      if (there === null) compartments.set(r, c, compartment);
      else if (!isAncestor(compartment, there)) return false;
    }
  return true;
}

/**
 * size: each row's height and column's width from the divs of each
 * compartment, children first; a column widened in proportion where the
 * compartment's name is wider than its columns; and its padding.
 */
function size(
  compartment: CompartmentGlyph,
  grid: Grid<Div>,
  heights: number[],
  widths: number[],
  horizontal: number[],
  vertical: number[]
) {
  for (const child of compartment.children)
    size(child, grid, heights, widths, horizontal, vertical);
  const { minCol, maxCol, minRow, maxRow } = span(compartment, grid, (div, r, c) => {
    // Only this compartment's own divs: a child's were sized with the child.
    if (div.compartment() !== compartment) return;
    const bounds = div.bounds() as Bounds;
    widths[c] = Math.max(widths[c] as number, bounds.width);
    heights[r] = Math.max(heights[r] as number, bounds.height);
  });
  let width = 0;
  for (let i = minCol; i <= maxCol; i += 1) width += widths[i] as number;
  const minWidth = textWidth(compartment.name);
  if (width < minWidth) {
    const factor = minWidth / width;
    for (let i = minCol; i <= maxCol; i += 1) widths[i] = (widths[i] as number) * factor;
  }
  // A compartment with no divs spans from Integer.MAX_VALUE: Java's index out of bounds.
  const at = (array: number[], i: number, add: number) => {
    array[checkIndex(i, array.length)] = (array[i] as number) + add;
  };
  at(widths, minCol, COMPARTMENT_PADDING);
  at(horizontal, minCol, COMPARTMENT_PADDING);
  at(widths, maxCol, COMPARTMENT_PADDING);
  at(horizontal, maxCol, -COMPARTMENT_PADDING);
  at(heights, minRow, COMPARTMENT_PADDING);
  at(vertical, minRow, COMPARTMENT_PADDING);
  at(heights, maxRow, COMPARTMENT_PADDING);
  at(vertical, maxRow, -COMPARTMENT_PADDING);
}

function removeEmptyRows(grid: Grid<Div>) {
  let r = 0;
  while (r < grid.rows) {
    if ((grid.getRow(r) ?? []).every((div) => div === null)) grid.removeRows(r, 1);
    else r += 1;
  }
}

function removeEmptyCols(grid: Grid<Div>) {
  let c = 0;
  while (c < grid.columns) {
    if ((grid.getColumn(c) ?? []).every((div) => div === null)) grid.removeColumns(c, 1);
    else c += 1;
  }
}

const count = (divs: (Div | null)[], place: Place) =>
  divs.filter((div) => div?.busyPlaces().has(place)).length;

/**
 * expandSameRoleSameRow: two compartments side by side can put inputs (or
 * outputs) in the reaction's row; all but one move to a new row below.
 */
function expandSameRoleSameRow(grid: Grid<Div>, reaction: Point) {
  const r = reaction.row;
  for (const place of ['LEFT', 'RIGHT'] as const) {
    // The grid's own row: it stays at r as rows are inserted below it.
    const row = grid.getRow(r) as (Div | null)[];
    let n = count(row, place);
    while (n > 1) {
      grid.insertRow(r + 1);
      for (let col = 0; col < row.length; col += 1) {
        const div = row[col] ?? null;
        if (div?.busyPlaces().has(place)) {
          grid.set(r + 1, col, div);
          grid.set(r, col, null);
          break;
        }
      }
      n = count(row, place);
    }
  }
}

/** expandSameRoleSameColumn: the same for catalysts (or regulators) in the reaction's column. */
function expandSameRoleSameColumn(grid: Grid<Div>, reaction: Point) {
  const c = reaction.col;
  for (const place of ['TOP', 'BOTTOM'] as const) {
    let column = grid.getColumn(c) as (Div | null)[];
    let n = count(column, place);
    while (n > 1) {
      grid.insertColumn(c + 1);
      for (let row = 0; row < column.length; row += 1) {
        const div = column[row] ?? null;
        if (div?.busyPlaces().has(place)) {
          grid.set(row, c + 1, div);
          grid.set(row, c, null);
          break;
        }
      }
      column = grid.getColumn(c) as (Div | null)[];
      n = count(column, place);
    }
  }
}

const kinds = (grid: Grid<Div>, cells: Point[]) => ({
  vertical: cells.some(({ row, col }) => grid.get(row, col) instanceof VerticalLayout),
  horizontal: cells.some(({ row, col }) => grid.get(row, col) instanceof HorizontalLayout),
});
const rowCells = (grid: Grid<Div>, row: number) =>
  Array.from({ length: grid.columns }, (_, col) => ({ row, col }));
const columnCells = (grid: Grid<Div>, col: number) =>
  Array.from({ length: grid.rows }, (_, row) => ({ row, col }));

/**
 * forceDiagonalTopDown: a row above the reaction holding both catalysts and
 * a column of inputs or outputs is split, the catalysts above; below the
 * reaction, the regulators below.
 */
function forceDiagonalTopDown(grid: Grid<Div>, reaction: Point) {
  let r = 0;
  while (r < reaction.row) {
    const { vertical, horizontal } = kinds(grid, rowCells(grid, r));
    if (horizontal && vertical) {
      grid.insertRows(r, 1);
      reaction.row += 1;
      for (let c = 0; c < grid.columns; c += 1)
        if (grid.get(r + 1, c) instanceof HorizontalLayout) {
          grid.set(r, c, grid.get(r + 1, c));
          grid.set(r + 1, c, null);
        }
    }
    r += 1;
  }
  r = reaction.row + 1;
  while (r < grid.rows) {
    const { vertical, horizontal } = kinds(grid, rowCells(grid, r));
    if (horizontal && vertical) {
      grid.insertRows(r + 1, 1);
      for (let c = 0; c < grid.columns; c += 1)
        if (grid.get(r, c) instanceof HorizontalLayout) {
          grid.set(r + 1, c, grid.get(r, c));
          grid.set(r, c, null);
        }
    }
    r += 1;
  }
}

/** forceDiagonalLeftRight: the same for columns, inputs left and outputs right of the rest. */
function forceDiagonalLeftRight(grid: Grid<Div>, reaction: Point) {
  let c = 0;
  while (c < reaction.col) {
    const { vertical, horizontal } = kinds(grid, columnCells(grid, c));
    if (horizontal && vertical) {
      grid.insertColumns(c, 1);
      reaction.col += 1;
      for (let r = 0; r < grid.rows; r += 1)
        if (grid.get(r, c + 1) instanceof VerticalLayout) {
          grid.set(r, c, grid.get(r, c + 1));
          grid.set(r, c + 1, null);
        }
    }
    c += 1;
  }
  c = reaction.col + 1;
  while (c < grid.columns) {
    const { vertical, horizontal } = kinds(grid, columnCells(grid, c));
    if (horizontal && vertical) {
      grid.insertColumns(c + 1, 1);
      for (let r = 0; r < grid.rows; r += 1)
        if (grid.get(r, c) instanceof VerticalLayout) {
          grid.set(r, c + 1, grid.get(r, c));
          grid.set(r, c, null);
        }
    }
    c += 1;
  }
}

/** containsRole: whether a div in the row or column holds any of the roles, positive counted as negative. */
function containsRole(divs: (Div | null)[] | null, roles: EntityRole[]): boolean {
  if (!divs) throw new JavaNullPointerException();
  return divs.some((div) => {
    if (div === null) return false;
    const contained = simplify(div.containedRoles());
    return roles.some((role) => contained.has(role));
  });
}

/**
 * layoutCompartment: a compartment's box round its children and its glyphs
 * -- the reaction with room round it, an input that is also a catalyst with
 * its connector over it -- padded, widened to its name, and its name's place.
 */
function layoutCompartment(compartment: CompartmentGlyph) {
  let b: Bounds | null = null;
  for (const child of compartment.children) {
    layoutCompartment(child);
    if (b === null) b = child.bounds.copy();
    else b.union(child.bounds);
  }
  for (const glyph of compartment.contained) {
    const bounds = glyph.kind === 'reaction' ? padded(boundsOf(glyph), 60, 40) : boundsOf(glyph);
    if (b === null) b = bounds.copy();
    else b.union(bounds);
    if (glyph.kind === 'entity') {
      const types = new Set(glyph.roles.map((role) => role.type));
      if (types.has('catalyst') && types.has('input')) {
        let top = glyph.bounds.y;
        for (const connector of glyph.connectors)
          for (const segment of connector.segments) if (segment.from.y < top) top = segment.from.y;
        b.union(Bounds.of(glyph.bounds.x, top, 1, 1));
      }
    }
  }
  if (b === null) throw new JavaNullPointerException();
  b.setX(b.x - COMPARTMENT_PADDING);
  b.setY(b.y - COMPARTMENT_PADDING);
  b.setWidth(b.width + 2 * COMPARTMENT_PADDING);
  b.setHeight(b.height + 2 * COMPARTMENT_PADDING);

  const nameWidth = textWidth(compartment.name);
  const nameHeight = LINE_HEIGHT;
  const textPadding = nameWidth + 30;
  if (b.width < textPadding) {
    const diff = textPadding - b.width;
    b.setWidth(textPadding);
    b.setX(b.x - 0.5 * diff);
  }
  // The name in the bottom right corner -- centred if it is wide, on top if a catalyst is inside.
  const centred = nameWidth > 0.5 * b.width;
  const x = centred ? b.cx - 0.5 * nameWidth : b.mx - nameWidth - 15;
  const y = holds(compartment, 'catalyst')
    ? b.y + 0.5 * nameHeight
    : b.my + 0.5 * nameHeight - COMPARTMENT_PADDING;
  compartment.labelPosition = { x, y };
  compartment.bounds = b;
}

/** Whether a glyph in the compartment, or in one inside it, has the role (GlyphUtils.getContainedRoles). */
function holds(compartment: CompartmentGlyph, type: EntityRole): boolean {
  for (const glyph of compartment.contained)
    if (glyph.kind === 'entity' && glyph.roles.some((role) => role.type === type)) return true;
  for (const child of compartment.children) if (holds(child, type)) return true;
  return false;
}

/** computeDimension: the compartments, the entities with their connectors, and the reaction. */
function dimension({ compartments, entities, reaction }: Inputs): Bounds {
  let b: Bounds | null = null;
  const union = (bounds: Bounds) => {
    if (b === null) b = bounds.copy();
    else b.union(bounds);
  };
  for (const compartment of compartments.values()) union(compartment.bounds);
  for (const entity of entities) {
    union(boundsOf(entity));
    for (const connector of entity.connectors)
      for (const { from, to } of connector.segments) {
        const minX = Math.min(from.x, to.x);
        const maxX = Math.max(from.x, to.x);
        const minY = Math.min(from.y, to.y);
        const maxY = Math.max(from.y, to.y);
        union(Bounds.of(minX, minY, maxX - minX, maxY - minY));
      }
  }
  union(boundsOf(reaction));
  const bounds = new Bounds();
  bounds.set(b as unknown as Bounds);
  return bounds;
}
