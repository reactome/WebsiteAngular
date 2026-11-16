import { beforeAll, describe, expect, it } from 'vitest';
import { firstValueFrom, type Observable } from 'rxjs';
import { type Cell, TableStore, type TableState } from './table.store';

/**
 * The table store, held to what it does today, step by step through an
 * editing session: generate, import, type, move, select, paste, delete, add and
 * remove rows and columns, and read it back through every selector.
 *
 * Written before the store's index reads were rewritten for
 * noUncheckedIndexedAccess (#345), so that rewrite can be shown to change
 * nothing: the snapshots were recorded against the code as it was.
 */

/** Everything a step can change, in a form a snapshot shows plainly. */
function view(state: TableState) {
  return {
    cells: state.dataset.map((row) =>
      row
        .map(
          (cell) =>
            (cell.value || '·') +
            (cell.selected ? '*' : '') +
            (cell.visibility === 'hidden' ? '^' : '')
        )
        .join(' | ')
    ),
    maxCols: state.maxCols.map((max) => `${max.value}@${max.coords.x},${max.coords.y}`),
    start: state.start,
    stop: state.stop,
    selected: state.selectedCoords.length,
    hasFocus: state.hasFocus,
  };
}

/** A selector's first value, or the error it throws: both are behaviour. */
async function read<T>(source: Observable<T>): Promise<T | string> {
  try {
    return await firstValueFrom(source);
  } catch (error) {
    return `threw ${error instanceof Error ? error.message : String(error)}`;
  }
}

const values = (cells: (Cell | undefined)[] | string) =>
  typeof cells === 'string' ? cells : cells.map((cell) => cell?.value);

async function selectors(store: TableStore) {
  return {
    value: await read(store.value$),
    colNames: await read(store.colNames$),
    rowNames: await read(store.rowNames$),
    range: await read(store.range$),
    cleanData: await read(store.cleanData$),
    hasData: await read(store.hasData$),
    columnByName: values(await read(store.column$({ name: 'B' }))),
    columnByIndex: values(await read(store.column$({ index: 1, includeName: true }))),
    rowByName: values(await read(store.row$({ name: '2' }))),
    // Asked only when there is a row 1: a selector that throws errors the
    // store's shared state stream, and every later read would come back empty.
    rowByIndex:
      store.state().dataset.length > 1
        ? values(await read(store.row$({ index: 1, includeName: true })))
        : 'no row 1',
  };
}

describe('TableStore through an editing session', () => {
  let store: TableStore;
  const steps: { step: string; state: ReturnType<typeof view> }[] = [];
  const record = (step: string) => steps.push({ step, state: view(store.state()) });

  // Built directly, not through TestBed: TestBed tears its injector down after
  // every test, which would destroy the store between the session's steps.
  beforeAll(() => {
    store = new TableStore();
  });

  it('starts empty', async () => {
    record('new');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('generates a template', async () => {
    store.init({ numberOfColumns: 4, numberOfRows: 5 });
    record('init 4x5');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('imports a table, mapping its headers onto the template', async () => {
    store.import({
      table: [
        ['', 'A', 'B', 'Extra'],
        ['1', 'TP53', '2.5', 'x'],
        ['2', 'BRCA1', '', 'y'],
        ['New', 'ATM', '-1', ''],
      ],
      hasRowNames: true,
      hasColNames: true,
    });
    record('import mapped');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('types into the selected cell, moving the column maximum up and down', async () => {
    store.selectCell({ coords: { x: 1, y: 2 } });
    store.write({ value: 'A-much-longer-gene-name' });
    record('write longer');
    store.write({ value: 'X' });
    record('write shorter');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('moves the selection, wrapping at the edges', () => {
    store.focusFirst();
    record('focusFirst');
    store.up({ shift: false });
    record('up wraps');
    store.left({ shift: false });
    record('left wraps');
    store.down({ shift: true });
    record('down shift');
    store.right({ shift: true });
    record('right shift');
    store.focusLast();
    record('focusLast');
    store.down({ shift: false });
    record('down wraps');
  });

  it('pastes over a range, and deletes one', async () => {
    store.selectRange({ start: { x: 1, y: 1 }, stop: { x: 2, y: 2 } });
    store.paste({
      table: [
        [' P1 ', 'P2'],
        ['P3', ''],
        ['P5', 'P6'],
      ],
    });
    record('paste');
    store.selectRange({ start: { x: 2, y: 1 }, stop: { x: 2, y: 3 } });
    store.delete();
    record('delete range');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('adds and removes rows and columns', async () => {
    store.addColumn();
    record('addColumn');
    store.addRow();
    record('addRow');
    store.deleteColumn({ name: 'Extra' });
    record('deleteColumn by name');
    store.deleteRow({ y: 1 });
    record('deleteRow by index');
    store.deleteRow({ name: 'New' });
    record('deleteRow by name');
    store.deleteColumn({ x: 0 });
    record('deleteColumn refused at 0');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('imports without mapping headers', async () => {
    store.settings({ settings: { importMapHeaders: false } });
    store.import({
      table: [['h1', 'h2'], ['v1', 'v2'], ['v3']],
      hasRowNames: false,
      hasColNames: false,
    });
    record('import unmapped');
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('clears back to the template', async () => {
    store.blur();
    record('blur');
    store.clear();
    record('clear');
    store.deselect();
    record('deselect');
    expect(await selectors(store)).toMatchSnapshot();
  });

  // Deleting the row the selection is in left the selection pointing at a row
  // that was gone; reading it threw, which ended the store's state stream and
  // left the table unusable.
  it('deletes the last row while a cell in it is selected', async () => {
    store.focusLast();
    const last = store.state().dataset.length - 1;
    store.deleteRow({ y: last });
    record('deleteRow of the selected last row');
    expect(store.state().dataset.length).toBe(last);
    expect(await selectors(store)).toMatchSnapshot();
  });

  it('went through every step as recorded', () => {
    expect(steps).toMatchSnapshot();
  });
});
