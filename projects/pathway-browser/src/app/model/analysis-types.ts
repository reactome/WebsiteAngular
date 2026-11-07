import type { AnalysisType } from '../../../../contract/analysis.ts';

/**
 * Every analysis type the service can return, as data, so a test can walk it.
 * GSA_STATISTICS, which is what PADOG produces, was once missing from such a
 * list and from the palette map, and the result was not a type error but a
 * blank view: see TYPE_DEFAULT_PALETTE in analysis.service.ts. Keyed by the
 * contract's union, so a type it adds is a compile error here until listed.
 */
const LISTED: Record<AnalysisType, true> = {
  OVERREPRESENTATION: true,
  EXPRESSION: true,
  GSA_REGULATION: true,
  GSA_STATISTICS: true,
  GSVA: true,
  SPECIES_COMPARISON: true,
};

const isListed = (key: string): key is AnalysisType => key in LISTED;

export const ANALYSIS_TYPES: readonly AnalysisType[] = Object.keys(LISTED).filter(isListed);
