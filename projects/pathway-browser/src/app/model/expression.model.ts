import type { ExpressionAnswer } from '../../../../contract/expression.ts';

export type {
  ExpressionAnswer,
  ExpressionExperiment,
  ExpressionNotShown,
  ExpressionRow,
  ExpressionTissue,
  Quantiles,
} from '../../../../contract/expression.ts';

/** The answer when there is a heatmap to draw (spec 024). */
export type ExpressionHeatmapAnswer = Extract<ExpressionAnswer, { kind: 'heatmap' }>;
