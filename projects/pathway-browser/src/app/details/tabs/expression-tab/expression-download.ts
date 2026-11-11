import type { ExpressionHeatmapAnswer, ExpressionRow } from '../../../model/expression.model';

/** The selection the heatmap is of, as the file names it. */
export interface ExpressionSelection {
  stId: string;
  displayName: string;
}

/** The five values each tissue has, in the order the table publishes them. */
const QUANTILES = ['min', 'q1', 'median', 'q3', 'max'];

/** A cell of the file: tabs and line breaks would split it, so they become spaces. */
const cell = (text: string | number) => String(text).replace(/[\t\r\n]+/g, ' ');

/**
 * The heatmap as a tab-separated file (spec 024, FR-009): the rows shown, in
 * the order shown, each tissue's five values exactly as the answer holds them
 * (empty where the table has none), under a header of `#` lines naming the
 * selection, the experiment, its source and date, the unit, the licence and
 * the citations it asks for.
 */
export function expressionTsv(
  answer: ExpressionHeatmapAnswer,
  rows: ExpressionRow[],
  selection: ExpressionSelection
): string {
  const { experiment } = answer;
  const header = [
    `# Reactome expression heatmap of ${cell(selection.displayName)} (${selection.stId})`,
    `# ${rows.length} genes shown of the selection's ${answer.counts.genes}`,
    `# Experiment: ${experiment.accession}, ${cell(experiment.title)} (${cell(experiment.design)}); updated ${experiment.updated}; ${experiment.source}`,
    '# Values: TPM per tissue (minimum, lower quartile, median, upper quartile, maximum), as published by Expression Atlas; genes chosen and ordered by Reactome',
    `# Licence: ${experiment.licence}`,
    ...experiment.citation.map((citation) => `# Cite: ${cell(citation)}`),
  ];
  const columns = [
    'Ensembl gene',
    'Gene name',
    ...experiment.tissues.flatMap((tissue) =>
      QUANTILES.map((quantile) => `${cell(tissue.label)} ${quantile}`)
    ),
  ];
  const lines = rows.map((row) =>
    [
      row.gene,
      cell(row.name),
      ...experiment.tissues.flatMap((_, t) => {
        const values = row.values[t];
        return values ? values.map((value) => String(value)) : QUANTILES.map(() => '');
      }),
    ].join('\t')
  );
  return [...header, columns.join('\t'), ...lines].join('\n') + '\n';
}

/** The file's name: the selection and the experiment it is from. */
export function expressionFileName(
  answer: ExpressionHeatmapAnswer,
  selection: ExpressionSelection
) {
  return `expression-${selection.stId.replace(/[^\w.-]+/g, '_')}-${answer.experiment.accession}.tsv`;
}
