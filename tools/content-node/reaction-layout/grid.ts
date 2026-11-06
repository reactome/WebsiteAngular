/**
 * reaction-exporter's Grid (research D22, step 3): a matrix that grows when
 * set beyond its size, and inserts and removes whole rows and columns. A row
 * is the grid's own array, as in Java: getRow hands it out, and a row kept
 * across an insertion elsewhere is still the grid's. A column is a copy.
 * Reading outside the grid is Java's ArrayIndexOutOfBoundsException.
 */
import { checkIndex } from './model.ts';

export class Grid<T> {
  rows: number;
  columns: number;
  #grid: (T | null)[][];

  /** new Grid(rows, columns), or Grid(clz, array): the array itself, not a copy. */
  constructor(rows: number, columns: number, grid?: (T | null)[][]) {
    this.rows = rows;
    this.columns = columns;
    this.#grid = grid ?? create<T>(rows, columns);
  }

  /** Grid(T[][]): its rows and the first row's length, which Java reads. */
  static of<T>(grid: (T | null)[][]): Grid<T> {
    const first = grid[checkIndex(0, grid.length)] as (T | null)[];
    return new Grid<T>(grid.length, first.length, grid);
  }

  /** The copy constructor: rows copied, so the copy's are its own. */
  copy(): Grid<T> {
    return new Grid<T>(
      this.rows,
      this.columns,
      this.#grid.map((row) => [...row])
    );
  }

  get(row: number, column: number): T | null {
    const cells = this.#grid[checkIndex(row, this.#grid.length)] as (T | null)[];
    return cells[checkIndex(column, cells.length)] as T | null;
  }

  set(row: number, column: number, element: T | null) {
    if (this.rows <= row) this.insertRows(this.rows, row - this.rows + 1);
    if (this.columns <= column) this.insertColumns(this.columns, column - this.columns + 1);
    const cells = this.#grid[checkIndex(row, this.#grid.length)] as (T | null)[];
    cells[checkIndex(column, cells.length)] = element;
  }

  insertRows(index: number, n: number) {
    if (n <= 0) return;
    const grid = create<T>(this.rows + n, this.columns);
    for (let r = 0; r < index; r += 1) grid[r] = this.#grid[r] as (T | null)[];
    for (let r = index; r < this.rows; r += 1) grid[r + n] = this.#grid[r] as (T | null)[];
    this.rows += n;
    this.#grid = grid;
  }

  insertColumns(index: number, n: number) {
    if (n <= 0) return;
    const grid = create<T>(this.rows, this.columns + n);
    for (let r = 0; r < this.rows; r += 1) {
      const from = this.#grid[r] as (T | null)[];
      const to = grid[r] as (T | null)[];
      for (let c = 0; c < index; c += 1) to[c] = from[c] as T | null;
      for (let c = index; c < this.columns; c += 1) to[c + n] = from[c] as T | null;
    }
    this.columns += n;
    this.#grid = grid;
  }

  insertRow(index: number) {
    this.insertRows(index, 1);
  }

  insertColumn(index: number) {
    this.insertColumns(index, 1);
  }

  /** The row itself; null past the last. */
  getRow(row: number): (T | null)[] | null {
    return row < this.rows
      ? (this.#grid[checkIndex(row, this.#grid.length)] as (T | null)[])
      : null;
  }

  /** A copy of the column; null past the last. */
  getColumn(column: number): (T | null)[] | null {
    if (column >= this.columns) return null;
    return this.#grid.map((row) => row[checkIndex(column, row.length)] as T | null);
  }

  removeRows(index: number, count: number) {
    const n = Math.min(count, this.rows - index);
    if (n <= 0) return;
    const p = index + n;
    this.#grid = [...this.#grid.slice(0, index), ...this.#grid.slice(p)];
    this.rows -= n;
  }

  removeColumns(index: number, count: number) {
    const n = Math.min(count, this.columns - index);
    if (n <= 0) return;
    const p = index + n;
    this.#grid = this.#grid.map((row) => [...row.slice(0, index), ...row.slice(p)]);
    this.columns -= n;
  }
}

/** A rows by columns array of nulls. */
export function create<T>(rows: number, columns: number): (T | null)[][] {
  return Array.from({ length: rows }, () => new Array<T | null>(columns).fill(null));
}
