/**
 * reaction-exporter's Box (research D22, step 3): a compartment as a matrix
 * of cells, with room for its child compartments' boxes, the reaction, and a
 * column or row of participants for each role -- inputs left, outputs right,
 * catalysts on top, regulators below.
 *
 * Its cells are Java's HashMap<Integer, HashMap<Integer, Div>>, rows filled
 * with computeIfAbsent, columns with put, and both iterated in Java's order
 * (an Integer hashes to itself). A box re-placed in a parent whose rows or
 * columns change keeps its old cell as well as its new one, as in Java, and
 * so is visited twice.
 */
import { JavaHashMap } from '../java-hashmap.ts';
import { create } from './grid.ts';
import { HorizontalLayout, VerticalLayout } from './layouts.ts';
import type { Div } from './layouts.ts';
import type { LayoutIndex } from './layout-index.ts';
import { JavaRuntimeException, checkIndex } from './model.ts';
import type { CompartmentGlyph, EntityGlyph, EntityRole, ReactionGlyph } from './model.ts';
import { allowances, placeOf, relativePosition, simplify } from './place.ts';
import type { Place } from './place.ts';

const HORIZONTAL_PADDING = 75;
const VERTICAL_PADDING = 40;

/** A cell of a grid: a row and a column. */
export interface Point {
  row: number;
  col: number;
}

const integer = (key: number) => key;

/** true before false. */
const trueFirst = (a: boolean, b: boolean) => (a === b ? 0 : a ? -1 : 1);

export class Box implements Div {
  readonly kind = 'box';
  columns = 0;
  rows = 0;
  readonly #compartment: CompartmentGlyph;
  readonly #index: LayoutIndex;
  readonly #divs = new JavaHashMap<number, JavaHashMap<number, Div>>({ hash: integer });
  #boxes: Box[] = [];
  #boxOrder: Box[][] = [];

  constructor(compartment: CompartmentGlyph, index: LayoutIndex) {
    this.#compartment = compartment;
    this.#index = index;
    this.#placeSubCompartments();
  }

  /**
   * The child compartments' boxes: one in the middle, two side by side or
   * one above the other as their roles allow, more stacked top down.
   */
  #placeSubCompartments() {
    const children = [...this.#compartment.children];
    this.#boxes = children.map((child) => new Box(child, this.#index));
    const boxes = this.#boxes;
    if (!boxes.length) {
      this.columns = 3;
      this.rows = 3;
      this.#boxOrder = [];
    } else if (boxes.length === 1) {
      const box = boxes[0] as Box;
      this.columns = 4 + box.columns;
      this.rows = 4 + box.rows;
      this.#set(2, 2, box);
      this.#boxOrder = [[box]];
    } else if (boxes.length === 2) {
      const [a, b] = boxes as [Box, Box];
      let place = relativePosition(a.busyPlaces(), b.busyPlaces());
      // b has every role.
      place ??= relativePosition(a.busyPlaces(), new Set());
      // Both have every role: Java logs it and puts them side by side.
      place ??= 'LEFT';
      if (place === 'LEFT') this.#placeHorizontal(a, b);
      else if (place === 'RIGHT') this.#placeHorizontal(b, a);
      else if (place === 'TOP') this.#placeVertical(a, b);
      else if (place === 'BOTTOM') this.#placeVertical(b, a);
    } else {
      // Top down: catalysts first, regulators last, then the fewest children.
      boxes.sort(
        (c, d) =>
          trueFirst(c.containedRoles().has('catalyst'), d.containedRoles().has('catalyst')) ||
          trueFirst(d.containedRoles().has('negative'), c.containedRoles().has('negative')) ||
          trueFirst(d.containedRoles().has('positive'), c.containedRoles().has('positive')) ||
          c.#children().length - d.#children().length
      );
      let mc = 0;
      let mr = 0;
      for (const box of boxes) {
        if (box.columns > mc) mc = box.columns;
        if (box.rows > mr) mr = box.rows;
      }
      boxes.forEach((box, i) => {
        box.columns = mc;
        box.rows = mr;
        this.#set(2 + i * (mr + 1), 2, box);
      });
      this.columns = mc === 0 ? 3 : 4 + mc;
      this.rows = mr === 0 ? 3 : mr * boxes.length + (boxes.length - 1) + 4;
      this.#boxOrder = boxes.map((box) => [box]);
    }
  }

  #placeHorizontal(left: Box, right: Box) {
    this.columns = 5 + left.columns + right.columns;
    const maxRows = Math.max(left.rows, right.rows);
    left.#setNumberOfRows(maxRows);
    right.#setNumberOfRows(maxRows);
    this.rows = 4 + maxRows;
    this.#set(2, 2, left);
    this.#set(2, 3 + left.columns, right);
    this.#boxOrder = [[left, right]];
  }

  #placeVertical(top: Box, bottom: Box) {
    this.rows = 5 + top.rows + bottom.rows;
    const maxCols = Math.max(top.columns, bottom.columns);
    top.#setNumberOfColumns(maxCols);
    bottom.#setNumberOfColumns(maxCols);
    this.columns = 4 + maxCols;
    this.#set(2, 2, top);
    this.#set(3 + top.rows, 2, bottom);
    this.#boxOrder = [[top], [bottom]];
  }

  #setNumberOfRows(maxRows: number) {
    if (this.rows === maxRows) return;
    this.rows = maxRows;
    if (!this.#boxOrder.length) return;
    const length = this.#boxOrder.length;
    const spaces = length - 1;
    const rowsPerBox = Math.trunc((this.rows - 4 - spaces) / length);
    const start = 2;
    for (let c = 0; c < (this.#boxOrder[0] as Box[]).length; c += 1)
      for (let row = 0; row < length; row += 1) {
        const r = start + row + row * rowsPerBox;
        const box = (this.#boxOrder[row] as Box[])[
          checkIndex(c, (this.#boxOrder[row] as Box[]).length)
        ] as Box;
        this.#set(r, 2, box);
        box.#setNumberOfRows(rowsPerBox);
      }
  }

  #setNumberOfColumns(columns: number) {
    if (this.columns === columns) return;
    this.columns = columns;
    if (!this.#boxOrder.length) return;
    for (const row of this.#boxOrder) {
      const length = row.length;
      const spaces = length - 1;
      const colsPerBox = Math.trunc((columns - 4 - spaces) / length);
      const start = 2;
      row.forEach((box, i) => {
        const c = start + i + i * colsPerBox;
        this.#set(2, c, box);
        box.#setNumberOfColumns(colsPerBox);
      });
    }
  }

  #set(row: number, col: number, div: Div) {
    this.#divs
      .computeIfAbsent(row, () => new JavaHashMap<number, Div>({ hash: integer }))
      .set(col, div);
  }

  /**
   * placeReaction: the reaction placed in this box if it is in this
   * compartment and the box has room for it, otherwise in a child box; its
   * cell from this box's corner, null when no box placed it.
   */
  placeReaction(): Point | null {
    for (const glyph of this.#compartment.contained) {
      if (glyph.kind !== 'reaction') continue;
      const position = this.#reactionPosition();
      // The reaction moved into a child compartment.
      if (position === null) break;
      const div = new HorizontalLayout([glyph]);
      div.setHorizontalPadding(HORIZONTAL_PADDING);
      div.setVerticalPadding(VERTICAL_PADDING);
      this.#set(position.row, position.col, div);
      return position;
    }
    let found: Point | null = null;
    this.#forEach((div, point) => {
      if (!(div instanceof Box)) return;
      const inner = div.placeReaction();
      if (inner !== null) found = { row: point.row + inner.row, col: point.col + inner.col };
    });
    return found;
  }

  /** getReactionPosition: where the reaction goes among the child boxes, or null if moved into one. */
  #reactionPosition(): Point | null {
    const children = this.#children().filter((div): div is Box => div instanceof Box);
    if (!children.length)
      return { row: Math.trunc(this.rows / 2), col: Math.trunc(this.columns / 2) };
    if (children.length === 1) {
      const child = children[0] as Box;
      const place = relativePosition(new Set(), child.busyPlaces());
      if (place === 'TOP') return { row: 1, col: Math.trunc(this.columns / 2) };
      if (place === 'BOTTOM') return { row: this.rows - 2, col: Math.trunc(this.columns / 2) };
      if (place === 'LEFT') return { row: Math.trunc(this.rows / 2), col: 1 };
      if (place === 'RIGHT') return { row: Math.trunc(this.rows / 2), col: this.columns - 2 };
      this.#moveReactionTo(child);
      return null;
    }
    // Shrink the room to where no child forbids it.
    let maxCol = this.columns - 1;
    let minCol = 1;
    let minRow = 1;
    let maxRow = this.rows - 1;
    this.#forEach((div, point) => {
      if (!(div instanceof Box)) return;
      const allowed = allowances(div.busyPlaces());
      if (!allowed.length) {
        this.#moveReactionTo(children[0] as Box);
        maxCol = -1;
      }
      if (!allowed.includes('LEFT')) minCol = Math.max(minCol, point.col);
      if (!allowed.includes('RIGHT')) maxCol = Math.min(maxCol, point.col + div.columns);
      if (!allowed.includes('TOP')) minRow = Math.max(minRow, point.row);
      if (!allowed.includes('BOTTOM')) maxRow = Math.min(maxRow, point.row + div.rows);
    });
    // The first cell beside a child -- left, right, above, below -- inside that room.
    let position: Point | null = null;
    this.#forEach((div, point) => {
      if (position !== null || !(div instanceof Box)) return;
      for (const p of [
        { row: point.row + Math.trunc(div.rows / 2), col: point.col - 1 },
        { row: point.row + Math.trunc(div.rows / 2), col: point.col + div.columns },
        { row: point.row - 1, col: point.col + Math.trunc(div.columns / 2) },
        { row: point.row + div.rows, col: point.col + Math.trunc(div.columns / 2) },
      ])
        if (minCol <= p.col && p.col < maxCol && minRow <= p.row && p.row < maxRow) {
          position = p;
          break;
        }
    });
    return position;
  }

  /**
   * moveReactionTo: the reaction into the child's compartment -- though its
   * own compartment stays this one, as Java leaves it. Asked a second time,
   * the reaction is gone: Java's RuntimeException, with no message.
   */
  #moveReactionTo(div: Box) {
    const reaction = [...this.#compartment.contained].find(
      (glyph): glyph is ReactionGlyph => glyph.kind === 'reaction'
    );
    if (!reaction) throw new JavaRuntimeException(null);
    this.#compartment.contained.delete(reaction);
    div.#compartment.contained.add(reaction);
    reaction.compartment = this.#compartment;
  }

  bounds(): null {
    return null;
  }

  center() {}

  containedRoles(): Set<EntityRole> {
    const roles = new Set<EntityRole>();
    for (const div of this.#children()) for (const role of div.containedRoles()) roles.add(role);
    for (const glyph of this.#compartment.contained)
      if (glyph.kind === 'entity') for (const role of glyph.roles) roles.add(role.type);
    return roles;
  }

  busyPlaces(): Set<Place> {
    const places = new Set<Place>();
    for (const glyph of this.#compartment.contained) {
      if (glyph.kind === 'reaction') places.add('CENTER');
      else for (const role of glyph.roles) places.add(placeOf(role.type));
    }
    for (const child of this.#children()) for (const place of child.busyPlaces()) places.add(place);
    return places;
  }

  compartment(): CompartmentGlyph {
    return this.#compartment;
  }

  /** getChildren: every cell's div, a box placed twice included twice. */
  #children(): Div[] {
    const children: Div[] = [];
    for (const row of this.#divs.values()) children.push(...row.values());
    return children;
  }

  #forEach(visit: (div: Div, point: Point) => void) {
    for (const [row, cells] of this.#divs.entries())
      for (const [col, div] of cells.entries()) visit(div, { row, col });
  }

  /** placeElements: the participants of this compartment in their rows and columns, child boxes first. */
  placeElements(reactionPosition: Point) {
    this.#forEach((div, point) => {
      if (div instanceof Box)
        div.placeElements({
          row: reactionPosition.row - point.row,
          col: reactionPosition.col - point.col,
        });
    });
    const divs = this.divs();
    const index = this.#index;
    const inputs = index.filterInputs(this.#compartment);
    const outputs = index.filterOutputs(this.#compartment);
    const catalysts = index.filterCatalysts(this.#compartment);
    const regulators = index.filterRegulators(this.#compartment);
    const catalyst = (entity: EntityGlyph) => entity.roles.some((role) => role.type === 'catalyst');
    const catalystInInputs = index.inputs.some(catalyst);
    const half = Math.trunc(this.columns / 2);
    const boxRoles = () => {
      const roles = new Set<EntityRole>();
      for (const box of this.#boxes)
        for (const role of simplify(box.containedRoles())) roles.add(role);
      return roles;
    };

    if (inputs.length) {
      const hasCatalyst = inputs.some(catalyst);
      const at = reactionPosition.row;
      let row: number;
      if (hasCatalyst) row = this.#freeRow(divs, ['input'], at, true, false);
      else if (this.#boxes.length && reactionPosition.col > half) {
        // These inputs' segments would likely cross a child: to the bottom.
        const roles = boxRoles();
        if (!roles.has('negative')) row = this.rows - 1;
        else if (!roles.has('catalyst')) row = 0;
        else row = this.#freeRow(divs, ['input'], at, false, catalystInInputs);
      } else row = this.#freeRow(divs, ['input'], at, false, catalystInInputs);
      this.#set(row, 0, new VerticalLayout(inputs));
    }
    if (outputs.length) {
      const at = reactionPosition.row;
      let row: number;
      if (this.#boxes.length && reactionPosition.col < half) {
        const roles = boxRoles();
        if (!roles.has('negative')) row = this.rows - 1;
        else if (!roles.has('catalyst')) row = 0;
        else row = this.#freeRow(divs, ['output'], at, false, catalystInInputs);
      } else row = this.#freeRow(divs, ['output'], at, false, catalystInInputs);
      this.#set(row, this.columns - 1, new VerticalLayout(outputs));
    }
    if (catalysts.length) {
      const column = this.#freeColumn(divs, ['catalyst'], reactionPosition.col);
      this.#set(0, column, new HorizontalLayout(catalysts));
    }
    if (regulators.length) {
      const column = this.#freeColumn(divs, ['negative', 'positive'], reactionPosition.col);
      this.#set(this.rows - 1, column, new HorizontalLayout(regulators));
    }
  }

  /** getFreeRow: the reaction's row if no div there has the roles, otherwise the nearest free one. */
  #freeRow(
    divs: (Div | null)[][],
    roles: EntityRole[],
    reactionRow: number,
    up: boolean,
    down: boolean
  ): number {
    // The reaction is below this box, or above it.
    if (reactionRow >= this.rows) return this.rows - 2;
    if (reactionRow < 0) return 1;
    if (this.#rowIsFree(divs, reactionRow, roles)) return reactionRow;
    if (up) return this.#freeRowUp(divs, roles, Math.trunc(this.rows / 2));
    if (down) return this.#freeRowDown(divs, roles, Math.trunc(this.rows / 2));
    const freeRowDown = this.#freeRowDown(divs, roles, Math.max(reactionRow, 0));
    const freeRowUp = this.#freeRowUp(divs, roles, Math.min(reactionRow, this.rows - 1));
    return reactionRow - freeRowUp > freeRowDown - reactionRow ? freeRowDown : freeRowUp;
  }

  #freeRowUp(divs: (Div | null)[][], roles: EntityRole[], start: number): number {
    for (let i = start; i > 1; i -= 1) if (this.#rowIsFree(divs, i, roles)) return i;
    return 1;
  }

  #freeRowDown(divs: (Div | null)[][], roles: EntityRole[], start: number): number {
    for (let i = start; i < this.rows - 1; i += 1) if (this.#rowIsFree(divs, i, roles)) return i;
    return this.rows - 1;
  }

  #rowIsFree(divs: (Div | null)[][], row: number, roles: EntityRole[]): boolean {
    const cells = divs[checkIndex(row, divs.length)] as (Div | null)[];
    for (let col = 0; col < this.columns; col += 1) {
      const div = cells[checkIndex(col, cells.length)];
      if (div && roles.some((role) => div.containedRoles().has(role))) return false;
    }
    return true;
  }

  /** getFreeColumn: the reaction's column if free, otherwise outwards from the middle. */
  #freeColumn(divs: (Div | null)[][], roles: EntityRole[], reactionColumn: number): number {
    if (reactionColumn >= this.columns) return this.columns - 2;
    if (reactionColumn < 0) return 1;
    if (!this.#columnIsBusy(divs, roles, reactionColumn)) return reactionColumn;
    const half = Math.trunc(this.columns / 2);
    let col = half;
    for (let i = 0; i < this.columns - 2; i += 1) {
      const h = Math.trunc(i / 2);
      col = i % 2 === 0 ? half - h : half + h;
      if (!this.#columnIsBusy(divs, roles, col)) break;
    }
    return col;
  }

  #columnIsBusy(divs: (Div | null)[][], roles: EntityRole[], col: number): boolean {
    for (let row = 0; row < this.rows; row += 1) {
      const cells = divs[checkIndex(row, divs.length)] as (Div | null)[];
      const div = cells[checkIndex(col, cells.length)];
      if (div && roles.some((role) => div.containedRoles().has(role))) return true;
    }
    return false;
  }

  /** getDivs: this box's cells with each child box's copied in at its place. */
  divs(): (Div | null)[][] {
    const divs = create<Div>(this.rows, this.columns);
    this.#forEach((div, point) => {
      if (div instanceof Box) {
        const inner = div.divs();
        for (let i = 0; i < div.rows; i += 1) {
          const target = divs[checkIndex(point.row + i, divs.length)] as (Div | null)[];
          arraycopy(inner[i] as (Div | null)[], target, point.col, div.columns);
        }
      } else {
        const target = divs[checkIndex(point.row, divs.length)] as (Div | null)[];
        target[checkIndex(point.col, target.length)] = div;
      }
    });
    return divs;
  }
}

/** System.arraycopy(source, 0, target, at, length), with its bounds checks. */
function arraycopy<T>(source: T[], target: T[], at: number, length: number) {
  if (at < 0)
    throw new JavaRuntimeException(
      `arraycopy: destination index ${at} out of bounds for object array[${target.length}]`
    );
  if (length > source.length)
    throw new JavaRuntimeException(
      `arraycopy: last source index ${length} out of bounds for object array[${source.length}]`
    );
  if (at + length > target.length)
    throw new JavaRuntimeException(
      `arraycopy: last destination index ${at + length} out of bounds for object array[${target.length}]`
    );
  for (let i = 0; i < length; i += 1) target[at + i] = source[i] as T;
}
