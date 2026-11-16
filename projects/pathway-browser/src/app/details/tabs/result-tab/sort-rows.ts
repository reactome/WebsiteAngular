import type { Sort } from '@angular/material/sort';
import { fieldByName } from '../../../services/utils';

/** What a row is sorted by in a column: undefined where it has nothing to sort by. */
export type SortKey = string | number | undefined;

/**
 * The value a column's id names in a row, its parts separated by '-':
 * `entities-fdr` is `row.entities.fdr`, `exp-2` is `row.exp[2]`. Undefined
 * where any part is missing.
 */
export function valueAtPath(row: object, columnId: string): unknown {
  return columnId
    .split('-')
    .reduce<unknown>(
      (value, key) =>
        typeof value === 'object' && value !== null ? fieldByName(value, key) : undefined,
      row
    );
}

/** A value as a sort key: text and numbers as they are, anything else as missing. */
export function sortKey(value: unknown): SortKey {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * MatTableDataSource's own sortData, for a key that may be missing.
 * Material's sortingDataAccessor is typed to return text or a number, but
 * its sortData handles a missing key (it sorts before every other key in
 * ascending order, after them in descending); the tables here rely on that,
 * so they sort through this instead. A number compared with text is compared
 * as text, as Material does.
 */
export function sortRows<T>(
  rows: T[],
  sort: Pick<Sort, 'active' | 'direction'>,
  keyOf: (row: T, columnId: string) => SortKey
): T[] {
  const { active, direction } = sort;
  if (!active || direction === '') return rows;
  return rows.sort((a, b) => {
    const keyA = keyOf(a, active);
    const keyB = keyOf(b, active);
    let result = 0;
    if (keyA !== undefined && keyB !== undefined) result = compareKeys(keyA, keyB);
    else if (keyA !== undefined) result = 1;
    else if (keyB !== undefined) result = -1;
    return result * (direction === 'asc' ? 1 : -1);
  });
}

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a > b ? 1 : a < b ? -1 : 0;
  const textA = String(a);
  const textB = String(b);
  return textA > textB ? 1 : textA < textB ? -1 : 0;
}
