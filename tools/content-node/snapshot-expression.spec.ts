// @vitest-environment node
//
// The refresh step's checks (spec 024, T010-T012), offline: it builds an
// experiment file from Expression Atlas's table and configuration, and refuses
// one that does not match them.
import { describe, expect, it } from 'vitest';
import type { ExperimentFile, ExperimentGene, ListedSpecies } from './expression-data.ts';
import { buildExperiment, cellOf, checkAgainstSource, groupsOf } from './snapshot-expression.ts';

const LISTED: ListedSpecies = {
  accession: 'E-TEST-1',
  design: '3 tissues from 4 individuals',
  citation: ['A citation.'],
  licence: 'CC BY 4.0',
};
const INFO = {
  experimentAccession: 'E-TEST-1',
  experimentDescription: 'RNA-seq of three tissues',
  species: 'Homo sapiens',
  lastUpdate: '23-01-2025',
};
const CONFIGURATION = `<configuration experimentType="rnaseq_mrna_baseline">
  <analytics>
    <assay_groups>
      <assay_group id="g1" label="spleen"><assay>A</assay><assay>B</assay></assay_group>
      <assay_group id="g2" label="brain &amp; spine"><assay>C</assay></assay_group>
      <assay_group id="g3" label="adipose tissue"><assay>D</assay><assay>E</assay><assay>F</assay></assay_group>
    </assay_groups>
  </analytics>
</configuration>`;
/** Each assay's organism part, as the condensed sample file writes it. */
const SDRF = [
  ['A', 'UBERON_0002106'],
  ['B', 'UBERON_0002106'],
  ['C', 'UBERON_0000955'],
  ['D', 'UBERON_0001013'],
  ['E', 'UBERON_0001013'],
  ['F', 'UBERON_0001013'],
]
  .map(([assay, id]) =>
    [
      `E-TEST-1\t\t${assay}\tcharacteristic\torganism\tHomo sapiens\thttp://purl.obolibrary.org/obo/NCBITaxon_9606`,
      `E-TEST-1\t\t${assay}\tfactor\torganism part\tsome tissue\thttp://purl.obolibrary.org/obo/${id}`,
    ].join('\n')
  )
  .join('\n');
const TABLE = [
  'GeneID\tGene Name\tg1\tg2\tg3',
  'ENSG00000000001\tONE\t1,2,3,4,5\t0.3,0.4,0.5,0.6,0.7\t10,20,30,40,50',
  'ENSG00000000002\tTWO\t0,0,0,0,0\t7,7,7,7,7\t\n',
].join('\n');

/** A gene of a file, failing the test if the file lacks it. */
function geneOf(file: ExperimentFile, id: string): ExperimentGene {
  const gene = file.genes[id];
  if (!gene) throw new Error(`${id} is not in the file`);
  return gene;
}

const build = (table = TABLE, configuration = CONFIGURATION, listed = LISTED, sdrf = SDRF) =>
  buildExperiment({
    species: 'Homo sapiens',
    listed,
    info: INFO,
    table,
    configuration,
    sdrf,
    fetched: '2026-11-10',
  });

describe('the sources', () => {
  it("reads a configuration's groups, labels decoded, samples counted", () => {
    expect(groupsOf(CONFIGURATION)).toEqual([
      { id: 'g1', label: 'spleen', samples: 2, assays: ['A', 'B'] },
      { id: 'g2', label: 'brain & spine', samples: 1, assays: ['C'] },
      { id: 'g3', label: 'adipose tissue', samples: 3, assays: ['D', 'E', 'F'] },
    ]);
  });

  it('reads a cell as five numbers, or none', () => {
    expect(cellOf('0.3,0.4,0.5,0.6,0.7')).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(cellOf('')).toBeNull();
  });

  it('refuses a cell of any other form, rather than reading it as no value', () => {
    for (const text of ['NA', '3', '1,2,3', '1,2,,4,5'])
      expect(() => cellOf(text)).toThrow('is not five numbers');
  });

  it('refuses a row with a cell missing', () => {
    expect(() => build(TABLE.replace('\t10,20,30,40,50', ''))).toThrow(
      'ENSG00000000001 has 4 cells for 5 columns'
    );
  });
});

describe('buildExperiment', () => {
  it("gives each tissue its samples' anatomy id", () => {
    expect(build().tissues.map((t) => [t.label, t.uberon])).toEqual([
      ['adipose tissue', 'UBERON_0001013'],
      ['brain & spine', 'UBERON_0000955'],
      ['spleen', 'UBERON_0002106'],
    ]);
  });

  it('refuses two tissues on one organ', () => {
    const same = SDRF.replace(/UBERON_0000955/g, 'UBERON_0002106');
    expect(() => build(TABLE, CONFIGURATION, LISTED, same)).toThrow(
      'spleen and brain & spine are both UBERON_0002106'
    );
  });

  it('refuses a sample that names two anatomy ids', () => {
    const twice = `${SDRF}\nE-TEST-1\t\tA\tfactor\torganism part\tliver\thttp://purl.obolibrary.org/obo/UBERON_0002107`;
    expect(() => build(TABLE, CONFIGURATION, LISTED, twice)).toThrow(
      'assay A names two anatomy ids: UBERON_0002106, UBERON_0002107'
    );
  });

  it('refuses a tissue whose samples name two anatomy ids', () => {
    const mixed = SDRF.replace(
      'obo/UBERON_0002106\nE-TEST-1\t\tB',
      'obo/UBERON_0002106\nE-TEST-1\t\tB'
    ).replace(
      /(\tB\tfactor\torganism part\tsome tissue\thttp:\/\/purl.obolibrary.org\/obo\/)UBERON_0002106/,
      '$1UBERON_0002107'
    );
    expect(() => build(TABLE, CONFIGURATION, LISTED, mixed)).toThrow(
      'spleen (g1) has 2 anatomy ids'
    );
  });

  it('orders tissues by label and keeps each value as the table has it', () => {
    const file = build();
    expect(file.tissues.map((t) => t.label)).toEqual(['adipose tissue', 'brain & spine', 'spleen']);
    expect(geneOf(file, 'ENSG00000000001').values).toEqual([
      [10, 20, 30, 40, 50],
      [0.3, 0.4, 0.5, 0.6, 0.7],
      [1, 2, 3, 4, 5],
    ]);
    expect(geneOf(file, 'ENSG00000000002').values[0]).toBeNull();
    expect(file.updated).toBe('2025-01-23');
    expect(file.title).toBe('RNA-seq of three tissues');
  });

  it('refuses a column the configuration does not name', () => {
    expect(() => build(TABLE.replace('\tg3', '\tg9'))).toThrow('column g9 is not a group');
  });
});

describe('checkAgainstSource', () => {
  it('passes a file built from its sources', () => {
    expect(checkAgainstSource(build(), TABLE, CONFIGURATION)).toEqual([]);
  });

  it('refuses a value that differs from the table', () => {
    const file = build();
    geneOf(file, 'ENSG00000000001').values[1] = [0.3, 0.4, 0.55, 0.6, 0.7];
    expect(checkAgainstSource(file, TABLE, CONFIGURATION, 200).join()).toMatch(
      /ENSG00000000001 in g2: wrote .* the table has "0.3,0.4,0.5,0.6,0.7"/
    );
  });

  it('refuses a gene lost on the way', () => {
    const file = build();
    delete file.genes['ENSG00000000002'];
    expect(checkAgainstSource(file, TABLE, CONFIGURATION)).toContain(
      '1 genes written for 2 in the table'
    );
  });

  it('refuses a configuration with a group the table has no column for', () => {
    const extra = CONFIGURATION.replace(
      '</assay_groups>',
      '<assay_group id="g4" label="liver"><assay>G</assay></assay_group></assay_groups>'
    );
    expect(checkAgainstSource(build(TABLE, extra), TABLE, extra)).toContain(
      '3 columns for 4 groups in the configuration'
    );
  });

  it('refuses five values out of order', () => {
    const misread = TABLE.replace('1,2,3,4,5', '5,4,3,2,1');
    expect(checkAgainstSource(build(misread), misread, CONFIGURATION).join()).toMatch(
      /ENSG00000000001 in spleen is not five ordered values/
    );
  });

  it('refuses a design line that names another number of tissues', () => {
    const listed = { ...LISTED, design: '27 tissues from 4 individuals' };
    expect(checkAgainstSource(build(TABLE, CONFIGURATION, listed), TABLE, CONFIGURATION)).toContain(
      'the design line "27 tissues from 4 individuals" does not name 3 tissues'
    );
  });

  it('refuses a design line whose sample counts the tissues do not hold', () => {
    const each = { ...LISTED, design: '3 tissues, 2 samples each' };
    expect(checkAgainstSource(build(TABLE, CONFIGURATION, each), TABLE, CONFIGURATION)).toContain(
      'the design line says 2 samples each, the tissues do not all have 2'
    );
    const total = { ...LISTED, design: '3 tissues, 7 samples' };
    expect(checkAgainstSource(build(TABLE, CONFIGURATION, total), TABLE, CONFIGURATION)).toContain(
      'the design line says 7 samples, the tissues hold 6'
    );
    const right = { ...LISTED, design: '3 tissues, 6 samples' };
    expect(checkAgainstSource(build(TABLE, CONFIGURATION, right), TABLE, CONFIGURATION)).toEqual(
      []
    );
  });
});
