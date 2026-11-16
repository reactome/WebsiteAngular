import type { Coords, TableState } from './table.store';
import { cellAt, rowAt } from './dataset';
import * as Ranges from './ranges';

export function select(state: TableState): TableState {
  state.selectedCoords.forEach((coords) => {
    // The previous selection, to un-mark: a cell of a row or column deleted
    // since is gone, with nothing to un-mark. Reading its row used to throw,
    // ending the store's state stream and leaving the table unusable.
    const cell = state.dataset[coords.y]?.[coords.x];
    if (cell) {
      cell.selected = false;
      cell.visibility = 'visible';
    }
  });
  state.selectedCoords = [];
  if (!state.hasFocus) return state;
  const range = Ranges.minMax(state.start, state.stop);
  for (let x = range.x.min; x <= range.x.max; x++) {
    for (let y = range.y.min; y <= range.y.max; y++) {
      selectCell({ x, y }, state);
      selectCell({ x: 0, y }, state);
    }
    selectCell({ x, y: 0 }, state);
  }
  const selectedCell = rowAt(state.dataset, state.start.y)[state.start.x];
  if (selectedCell) selectedCell.visibility = 'hidden';
  return state;
}

function selectCell(coords: Coords, state: TableState): Coords {
  cellAt(state.dataset, coords.x, coords.y).selected = true;
  state.selectedCoords.push(coords);
  return coords;
}
