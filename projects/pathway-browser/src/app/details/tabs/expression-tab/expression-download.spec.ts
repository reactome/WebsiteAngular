import { describe, expect, it } from 'vitest';
import type { ExpressionHeatmapAnswer } from '../../../model/expression.model';
import { expressionFileName, expressionTsv } from './expression-download';

const ANSWER: ExpressionHeatmapAnswer = {
  kind: 'heatmap',
  experiment: {
    accession: 'E-TEST-1',
    title: 'Two tissues',
    design: '2 tissues from 3 individuals',
    species: 'Homo sapiens',
    source: 'https://www.ebi.ac.uk/gxa/experiments/E-TEST-1',
    updated: '2025-01-23',
    fetched: '2026-11-11',
    citation: ['A paper.', 'Another.'],
    licence: 'CC BY 4.0',
    tissues: [
      { id: 'g1', label: 'liver', samples: 3, uberon: 'UBERON_0002107' },
      { id: 'g2', label: 'spleen', samples: 1, uberon: 'UBERON_0002106' },
    ],
  },
  rows: [
    {
      gene: 'ENSG00000171791',
      name: 'BCL2',
      values: [[1, 2, 3, 4, 5], null],
      from: [{ identifier: 'P10415', stId: 'R-HSA-1', displayName: 'BCL2' }],
    },
    {
      gene: 'ENSG00000087088',
      name: 'BAX',
      values: [
        [0.3, 0.4, 0.5, 0.6, 0.7],
        [7, 7, 7, 7, 7],
      ],
      from: [{ identifier: 'Q07812', stId: 'R-HSA-2', displayName: 'BAX' }],
    },
  ],
  notShown: [],
  counts: { shown: 2, genes: 3 },
};
const SELECTION = { stId: 'R-HSA-109606', displayName: 'Intrinsic Pathway for Apoptosis' };

describe('expressionTsv', () => {
  const lines = expressionTsv(ANSWER, ANSWER.rows, SELECTION).trimEnd().split('\n');
  const table = lines.filter((line) => !line.startsWith('#'));

  it('names the selection, the experiment, the unit, the licence and the citations', () => {
    const header = lines.filter((line) => line.startsWith('#')).join('\n');
    expect(header).toContain('Intrinsic Pathway for Apoptosis (R-HSA-109606)');
    expect(header).toContain("2 genes shown of the selection's 3");
    expect(header).toContain(
      'E-TEST-1, Two tissues (2 tissues from 3 individuals); updated 2025-01-23'
    );
    expect(header).toContain('TPM per tissue');
    expect(header).toContain('# Licence: CC BY 4.0');
    expect(header).toContain('# Cite: A paper.\n# Cite: Another.');
  });

  it('has five columns per tissue, named for it', () => {
    expect(table[0]?.split('\t')).toEqual([
      'Ensembl gene',
      'Gene name',
      'liver min',
      'liver q1',
      'liver median',
      'liver q3',
      'liver max',
      'spleen min',
      'spleen q1',
      'spleen median',
      'spleen q3',
      'spleen max',
    ]);
  });

  it('writes the rows in the order given, each value as the answer has it', () => {
    expect(table.slice(1).map((line) => line.split('\t'))).toEqual([
      ['ENSG00000171791', 'BCL2', '1', '2', '3', '4', '5', '', '', '', '', ''],
      ['ENSG00000087088', 'BAX', '0.3', '0.4', '0.5', '0.6', '0.7', '7', '7', '7', '7', '7'],
    ]);
    const reordered = expressionTsv(ANSWER, [...ANSWER.rows].reverse(), SELECTION);
    expect(
      reordered
        .split('\n')
        .filter((l) => /^ENSG/.test(l))
        .map((l) => l.split('\t')[1])
    ).toEqual(['BAX', 'BCL2']);
  });
});

describe('expressionFileName', () => {
  it('names the selection and the experiment, safely', () => {
    expect(expressionFileName(ANSWER, SELECTION)).toBe('expression-R-HSA-109606-E-TEST-1.tsv');
    expect(expressionFileName(ANSWER, { stId: 'uniprot:P10415', displayName: '' })).toBe(
      'expression-uniprot_P10415-E-TEST-1.tsv'
    );
  });
});
