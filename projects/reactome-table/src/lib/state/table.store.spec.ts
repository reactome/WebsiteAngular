import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { cell, TableStore } from './table.store';

/**
 * The grid always carries a trailing blank row and column -- that is how the
 * store finds the end of the user's data -- so the fixtures include them.
 */
function grid(columnName: string) {
  return [
    [cell(''), cell(columnName), cell('')],
    [cell('1'), cell('TP53'), cell('')],
    [cell('2'), cell('BAX'), cell('')],
    [cell('3'), cell(''), cell('')],
  ];
}

function storeWith(columnName: string) {
  const store = TestBed.inject(TableStore);
  store.setState((state) => ({
    ...state,
    dataset: grid(columnName),
    numberOfRows: 4,
    numberOfColumns: 3,
    settings: { ...state.settings, renameCols: true, renameRows: false },
  }));
  return store;
}

describe('TableStore.cleanData$', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [TableStore] }));

  it('keeps the data when the column has been given a name', async () => {
    expect(await firstValueFrom(storeWith('Genes').cleanData$)).toEqual([
      ['Genes'],
      ['TP53'],
      ['BAX'],
    ]);
  });

  // The reported bug: an unnamed column made the header row look like the first
  // empty row, so the whole table was sliced away and an empty dataset was
  // submitted -- which the analysis service rejected with nothing to show.
  it('keeps the data when the column has been left unnamed', async () => {
    expect(await firstValueFrom(storeWith('').cleanData$)).toEqual([[''], ['TP53'], ['BAX']]);
  });
});
