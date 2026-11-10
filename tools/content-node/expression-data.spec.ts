// @vitest-environment node
//
// The expression tables (spec 024, T004-T005): a listed species' file is
// loaded, checked and packed; anything else is "not listed" or "unavailable",
// never another species' file.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { experimentFor, problemsOf, valuesAt } from './expression-data.ts';
import type { ExperimentFile, ExperimentGene } from './expression-data.ts';

const FIXTURE = readFileSync(
  new URL('./fixtures/expression-fixture.json', import.meta.url),
  'utf8'
);
const fixture = (): ExperimentFile => JSON.parse(FIXTURE) as ExperimentFile;

/** A gene of a file, failing the test if the file lacks it. */
function geneOf(file: ExperimentFile, id: string): ExperimentGene {
  const gene = file.genes[id];
  if (!gene) throw new Error(`${id} is not in the file`);
  return gene;
}

/** A folder holding `file` as the human experiment's file. */
function folderWith(file: unknown): string {
  const folder = mkdtempSync(join(tmpdir(), 'expression-'));
  writeFileSync(join(folder, 'E-MTAB-2836.json'), JSON.stringify(file));
  return folder;
}

describe('an experiment file', () => {
  it('holds together as the refresh step writes it', () => {
    expect(problemsOf(fixture())).toEqual([]);
  });

  it('is refused with a gene short of a tissue', () => {
    const file = fixture();
    geneOf(file, 'ENSG00000171791').values.pop();
    expect(problemsOf(file)).toContain('ENSG00000171791 has 28 values for 29 tissues');
  });

  it('is refused with five values out of order, a column misread', () => {
    const file = fixture();
    geneOf(file, 'ENSG00000171791').values[0] = [5, 4, 3, 2, 1];
    expect(problemsOf(file).join()).toMatch(/ENSG00000171791 in .* is not five ordered values/);
  });

  it('is refused with a versioned gene id', () => {
    const file = fixture();
    file.genes['ENSG00000171791.17'] = geneOf(file, 'ENSG00000171791');
    expect(problemsOf(file)).toContain('ENSG00000171791.17 is not a versionless Ensembl gene id');
  });
});

describe('experimentFor', () => {
  it('loads and packs a listed species, values exactly as written', () => {
    const answer = experimentFor('Homo sapiens', folderWith(fixture()));
    expect(answer.kind).toBe('experiment');
    if (answer.kind !== 'experiment') return;
    const { loaded } = answer;
    expect(loaded.experiment.tissues).toHaveLength(29);
    const bcl2 = loaded.index.get('ENSG00000171791') ?? -1;
    expect(loaded.names[bcl2]).toBe('BCL2');
    expect(valuesAt(loaded, bcl2)).toEqual(geneOf(fixture(), 'ENSG00000171791').values);
    expect(loaded.byName.get('SOD2')).toEqual([loaded.index.get('ENSG00000112096')]);
  });

  it('says a species with no listed experiment is not listed', () => {
    expect(experimentFor('Danio rerio', folderWith(fixture())).kind).toBe('not-listed');
  });

  it('is unavailable without a configured folder', () => {
    expect(experimentFor('Homo sapiens', '')).toEqual({
      kind: 'unavailable',
      why: 'no expression data directory is configured',
    });
  });

  it('is unavailable when the species file is missing', () => {
    const answer = experimentFor('Homo sapiens', mkdtempSync(join(tmpdir(), 'expression-')));
    expect(answer.kind).toBe('unavailable');
  });

  it('is unavailable when the file does not hold together', () => {
    const file = fixture();
    geneOf(file, 'ENSG00000171791').values.pop();
    expect(experimentFor('Homo sapiens', folderWith(file)).kind).toBe('unavailable');
  });

  it("refuses another experiment's file under this species' name", () => {
    const file = { ...fixture(), accession: 'E-MTAB-3718', species: 'Mus musculus' };
    expect(experimentFor('Homo sapiens', folderWith(file))).toEqual({
      kind: 'unavailable',
      why: 'E-MTAB-2836.json describes another experiment',
    });
  });
});
