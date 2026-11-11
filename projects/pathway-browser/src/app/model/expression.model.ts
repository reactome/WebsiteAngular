import type { ExpressionAnswer, ExpressionRow } from '../../../../contract/expression.ts';

export type {
  ExpressionAnswer,
  ExpressionNotShown,
  ExpressionRow,
  Quantiles,
} from '../../../../contract/expression.ts';

/** The answer when there is a heatmap to draw (spec 024). */
export type ExpressionHeatmapAnswer = Extract<ExpressionAnswer, { kind: 'heatmap' }>;

/** What the reader points at or focuses on the heatmap: a gene's row, a tissue, or nothing. */
export interface ExpressionPointed {
  row: ExpressionRow | null;
  tissue: number | null;
}
