import type { Coords, LocatedValue, TableState } from './table.store';
import { height, width } from '../utils/table.util';
import { cellAt } from './dataset';

type MinMax = { min: number; max: number };
type Range = { x: MinMax; y: MinMax };

export function minMax(start: Coords, stop: Coords): Range {
  return {
    x: { min: Math.min(start.x, stop.x), max: Math.max(start.x, stop.x) },
    y: { min: Math.min(start.y, stop.y), max: Math.max(start.y, stop.y) },
  };
}

export function origin(state: TableState): Coords {
  return {
    x: state.settings.renameRows ? 0 : 1,
    y: state.settings.renameCols ? 0 : 1,
  };
}

export function equals(a: Coords, b: Coords): boolean {
  return a.x === b.x && a.y === b.y;
}

export function limits(state: TableState): Range {
  const from = origin(state);
  return {
    x: { min: from.x, max: width(state.dataset) },
    y: { min: from.y, max: height(state.dataset) },
  };
}

export function limitRange(range: Range, state: TableState, bounds = limits(state)): Range {
  return {
    x: {
      min: limit(range.x.min, bounds.x.min, bounds.x.max),
      max: limit(range.x.max, bounds.x.min, bounds.x.max),
    },
    y: {
      min: limit(range.y.min, bounds.y.min, bounds.y.max),
      max: limit(range.y.max, bounds.y.min, bounds.y.max),
    },
  };
}

export function limitCoords(coords: Coords, state: TableState): Coords {
  const { x, y } = origin(state);
  return {
    x: limit(coords.x, x, width(state.dataset)),
    y: limit(coords.y, y, height(state.dataset)),
  };
}

function limit(value: number, lowerLimit: number, upperLimit: number): number {
  if (value < lowerLimit) return lowerLimit;
  if (value > upperLimit) return upperLimit;
  return value;
}

function column<T>(table: T[][], x: number): T[] {
  // Every row as wide as the first; see atColumn in table.store.ts.
  return table.map((row: T[]) => row[x] as T);
}

export function findMaximumOfColumn(state: TableState, x: number): LocatedValue {
  return column(state.dataset, x).reduce(
    (max, e, y) =>
      e.value.length > max.value.length
        ? {
            value: e.value,
            coords: { x, y },
          }
        : max,
    { value: cellAt(state.dataset, x, state.start.y).value, coords: state.start }
  );
}
