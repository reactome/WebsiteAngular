/**
 * The interactor export, checked without a browser.
 *
 * The shape under test is what the cytoscape node actually carries -- acc, alias,
 * score, evidences -- read off a running diagram, not the details-panel table's
 * fields, which are different and were what an early draft of the data model
 * wrongly specified.
 */
import { describe, expect, it } from 'vitest';
import { interactorFilename, interactorsToTsv } from './interactor-export';

/**
 * The rows, without destroying them on the way.
 *
 * `.trim()` on the whole document eats the final tab of a row whose last column
 * is empty, which is exactly the case worth asserting -- an interaction with no
 * evidence count. Two of these tests failed against correct output until this
 * stopped being `tsv.trim().split('\n')`.
 */
const rowsOf = (tsv: string) =>
  tsv.split('\n').filter((line, index, all) => index < all.length - 1);

describe('the interactor export', () => {
  const rows = [
    { entity: 'KLF15', alias: 'FOS', acc: 'P01100', score: 0.98, evidences: 4 },
    { entity: 'KLF15', alias: 'GRN', acc: 'P28799', score: 0.527, evidences: 1 },
  ];

  it('leads with a header naming every column', () => {
    expect(interactorsToTsv(rows).split('\n')[0]).toBe(
      'entity\tinteractor\taccession\tscore\tevidences'
    );
  });

  it('writes one row per interaction, in the order given', () => {
    const lines = rowsOf(interactorsToTsv(rows));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('KLF15\tFOS\tP01100\t0.98\t4');
    expect(lines[2]).toBe('KLF15\tGRN\tP28799\t0.527\t1');
  });

  it('falls back to the accession when there is no alias', () => {
    const tsv = interactorsToTsv([{ entity: 'KLF15', acc: 'A0A6Q8PF08', score: 0.5 }]);
    expect(rowsOf(tsv)[1]).toBe('KLF15\tA0A6Q8PF08\tA0A6Q8PF08\t0.5\t');
  });

  it('never lets a value break the columns', () => {
    // A tab inside a field would shift every later column of that row.
    const tsv = interactorsToTsv([{ entity: 'E', alias: 'a\tb\nc', acc: 'X', score: 1 }]);
    const row = rowsOf(tsv)[1];
    expect(row.split('\t')).toHaveLength(5);
    expect(row).toContain('a b c');
  });

  it('gives an empty set a header and nothing else', () => {
    expect(interactorsToTsv([])).toBe('entity\tinteractor\taccession\tscore\tevidences\n');
  });

  it('names the file after what it came from', () => {
    expect(interactorFilename('R-HSA-1368108', 'IntAct')).toBe(
      'Interactors [R-HSA-1368108] [IntAct].tsv'
    );
    expect(interactorFilename(null, null)).toBe('Interactors.tsv');
  });
});
