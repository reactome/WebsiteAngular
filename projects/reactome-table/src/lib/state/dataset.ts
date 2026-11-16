import type { Cell } from './table.store';

/**
 * The row at y. Out of range it throws, as reading a cell of it always did --
 * now saying where rather than reading a property of undefined.
 */
export function rowAt(dataset: Cell[][], y: number): Cell[] {
  const row = dataset[y];
  if (!row) throw new RangeError(`The table has no row ${y}.`);
  return row;
}

/** The cell at x, y; out of range it throws, as reading it always did. */
export function cellAt(dataset: Cell[][], x: number, y: number): Cell {
  const found = rowAt(dataset, y)[x];
  if (!found) throw new RangeError(`The table has no cell at ${x}, ${y}.`);
  return found;
}
