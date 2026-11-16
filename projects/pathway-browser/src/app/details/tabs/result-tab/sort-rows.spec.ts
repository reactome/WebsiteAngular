import { describe, expect, it } from 'vitest';
import { MatTableDataSource } from '@angular/material/table';
import { MatSort, SortDirection } from '@angular/material/sort';
import { SortKey, sortKey, sortRows, valueAtPath } from './sort-rows';
import { FoundIdentifier, foundSortKey } from './found-table/found-table.component';

type Row = { name: string; key: SortKey };

const rows = (...keys: SortKey[]): Row[] => keys.map((key, i) => ({ name: `r${i}`, key }));
const keysOf = (sorted: Row[]) => sorted.map((row) => row.key);
const by = (direction: SortDirection) => ({ active: 'key', direction });
const keyOf = (row: Row) => row.key;

describe('sortRows', () => {
  it('puts a missing key first ascending and last descending', () => {
    expect(keysOf(sortRows(rows(3, undefined, 1, 2), by('asc'), keyOf))).toEqual([
      undefined,
      1,
      2,
      3,
    ]);
    expect(keysOf(sortRows(rows(3, undefined, 1, 2), by('desc'), keyOf))).toEqual([
      3,
      2,
      1,
      undefined,
    ]);
  });

  it('compares numbers as numbers, and a number with text as text', () => {
    expect(keysOf(sortRows(rows(10, 9, -1), by('asc'), keyOf))).toEqual([-1, 9, 10]);
    expect(keysOf(sortRows(rows('9', 10), by('asc'), keyOf))).toEqual([10, '9']);
  });

  it('leaves the rows as they are with no column or no direction', () => {
    expect(keysOf(sortRows(rows(1, 3, 2), by(''), keyOf))).toEqual([1, 3, 2]);
    expect(keysOf(sortRows(rows(2, 1), { active: '', direction: 'asc' }, keyOf))).toEqual([2, 1]);
  });

  it('sorts as Material does where every row has a key', () => {
    const keys: SortKey[] = [5, 0, -2.5, 5, 13, 1e-9, 7, 0.5];
    for (const direction of ['asc', 'desc'] as const) {
      const material = new MatTableDataSource<Row>();
      material.sortingDataAccessor = (row) => row.key ?? '';
      const sort = new MatSort();
      sort.active = 'key';
      sort.direction = direction;
      expect(sortRows(rows(...keys), by(direction), keyOf)).toEqual(
        material.sortData(rows(...keys), sort)
      );
    }
  });
});

describe('valueAtPath', () => {
  const pathway = { name: 'P', entities: { fdr: 0.01, exp: [0, 2.5] }, species: { name: 'H' } };

  it('reads the value a column id names', () => {
    expect(valueAtPath(pathway, 'name')).toBe('P');
    expect(valueAtPath(pathway, 'entities-fdr')).toBe(0.01);
    expect(valueAtPath(pathway, 'entities-exp-1')).toBe(2.5);
    expect(valueAtPath(pathway, 'species-name')).toBe('H');
  });

  it('reads a missing part, or a part of a plain value, as undefined', () => {
    expect(valueAtPath(pathway, 'entities-exp-4')).toBeUndefined();
    expect(valueAtPath(pathway, 'reactions-fdr')).toBeUndefined();
    expect(valueAtPath(pathway, 'entities-fdr-x')).toBeUndefined();
  });
});

describe('sortKey', () => {
  it('keeps text and numbers, 0 among them, and drops anything else', () => {
    expect(sortKey(0)).toBe(0);
    expect(sortKey('')).toBe('');
    expect(sortKey('a')).toBe('a');
    expect(sortKey([1])).toBeUndefined();
    expect(sortKey({})).toBeUndefined();
    expect(sortKey(null)).toBeUndefined();
    expect(sortKey(true)).toBeUndefined();
  });
});

describe('foundSortKey', () => {
  const found: FoundIdentifier = {
    id: 'P01',
    exp: [0, 3],
    entities: { UNIPROT: ['P01', 'P02'] },
    interactors: ['Q1'],
  };

  it('sorts a list by its length, then its items', () => {
    expect(foundSortKey(found, 'entities-UNIPROT')).toBe('2-P01-P02');
    expect(foundSortKey(found, 'interactors')).toBe('1-Q1');
  });

  it('sorts a falsy or missing value as missing', () => {
    expect(foundSortKey(found, 'exp-0')).toBeUndefined();
    expect(foundSortKey(found, 'entities-CHEBI')).toBeUndefined();
    expect(foundSortKey(found, 'exp-1')).toBe(3);
    expect(foundSortKey(found, 'id')).toBe('P01');
  });
});
