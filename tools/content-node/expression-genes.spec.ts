// @vitest-environment node
//
// The matching rules (spec 024, T006-T007), on the fixture cut from
// E-MTAB-2836's table, with the cases measured in research R2.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pack } from './expression-data.ts';
import type { ExperimentFile } from './expression-data.ts';
import { matchGenes } from './expression-genes.ts';
import type { SelectionEntity } from './expression-genes.ts';

const file = JSON.parse(
  readFileSync(new URL('./fixtures/expression-fixture.json', import.meta.url), 'utf8')
) as ExperimentFile;
const loaded = pack(file);
const row = (gene: string) => loaded.index.get(gene) ?? -1;

const product = (
  identifier: string,
  geneName: string[],
  ensemblGenes: string[],
  stId = `R-HSA-${identifier}`
): SelectionEntity => ({
  stId,
  displayName: `UniProt:${identifier} ${geneName[0] ?? ''}`,
  identifier,
  schemaClass: 'ReferenceGeneProduct',
  geneName,
  ensemblGenes,
});

describe('matchGenes', () => {
  it("finds a protein's gene by its referenceGene link", () => {
    const { genes, notShown, counted } = matchGenes(
      [product('P10415', ['BCL2'], ['ENSG00000171791'])],
      loaded
    );
    expect(genes.map((g) => g.row)).toEqual([row('ENSG00000171791')]);
    expect(notShown).toEqual([]);
    expect(counted).toBe(1);
  });

  it('finds SOD2 by name: Reactome names an Ensembl id the table predates', () => {
    const { genes, notShown } = matchGenes(
      [product('P04179', ['SOD2'], ['ENSG00000291237'])],
      loaded
    );
    expect(genes.map((g) => g.row)).toEqual([row('ENSG00000112096')]);
    expect(notShown).toEqual([]);
  });

  it('keeps the gene the product is named for, of a gene and its readthrough', () => {
    const { genes } = matchGenes(
      [product('O43196', ['MSH5'], ['ENSG00000204410', 'ENSG00000255152'])],
      loaded
    );
    expect(genes.map((g) => g.row)).toEqual([row('ENSG00000204410')]);
  });

  it("draws both of a protein's duplicated genes", () => {
    const { genes } = matchGenes(
      [product('O15263', ['DEFB4A', 'DEFB4B'], ['ENSG00000171711', 'ENSG00000177257'])],
      loaded
    );
    expect(genes.map((g) => g.row).sort()).toEqual(
      [row('ENSG00000171711'), row('ENSG00000177257')].sort()
    );
  });

  it('folds an isoform into its parent: one product, one gene, both named', () => {
    const isoform = {
      ...product('P10415', ['BCL2'], ['ENSG00000171791'], 'R-HSA-ISOFORM'),
      schemaClass: 'ReferenceIsoform',
    };
    const { genes, counted } = matchGenes(
      [product('P10415', ['BCL2'], ['ENSG00000171791']), isoform],
      loaded
    );
    expect(counted).toBe(1);
    expect(genes).toHaveLength(1);
    expect(genes[0]?.from.map((f) => f.stId)).toEqual(['R-HSA-P10415', 'R-HSA-ISOFORM']);
  });

  it("uses a gene reference's own Ensembl id", () => {
    const gene: SelectionEntity = {
      stId: 'R-HSA-BBC3-GENE',
      displayName: 'ENSEMBL:ENSG00000105327 BBC3',
      identifier: 'ENSG00000105327',
      schemaClass: 'ReferenceDNASequence',
      geneName: ['BBC3'],
      ensemblGenes: [],
    };
    expect(matchGenes([gene], loaded).genes.map((g) => g.row)).toEqual([row('ENSG00000105327')]);
  });

  it('says why a product has no row: no gene, or a gene not in the table', () => {
    const { notShown } = matchGenes(
      [product('P01834', ['IGKC'], []), product('P0DUMMY', ['NOT-A-GENE'], ['ENSG00000999999'])],
      loaded
    );
    expect(notShown.map((n) => [n.identifier, n.reason])).toEqual([
      ['P01834', 'no-gene'],
      ['P0DUMMY', 'not-in-experiment'],
    ]);
  });

  it('leaves chemicals and drugs out, uncounted', () => {
    const atp: SelectionEntity = {
      stId: 'chebi:30616',
      displayName: 'ATP(4-)',
      identifier: '30616',
      schemaClass: 'ReferenceMolecule',
      geneName: [],
      ensemblGenes: [],
    };
    expect(matchGenes([atp], loaded)).toEqual({ genes: [], notShown: [], counted: 0 });
  });

  it('draws a gene expressed nowhere: zero is a measurement', () => {
    const { genes } = matchGenes([product('Q14773', ['ICAM4'], ['ENSG00000105371'])], loaded);
    expect(genes.map((g) => g.row)).toEqual([row('ENSG00000105371')]);
  });
});
