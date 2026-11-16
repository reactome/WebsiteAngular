// The Expression tab's heatmap (spec 024): what
// /ContentService/expression/{id} answers, node only. Expression Atlas's own
// widget, which the tab embedded, ignores the genes it is asked about (asked
// for BCL2 or a pathway, it drew the same 29 of 9,570 default genes), so the
// service looks the selection's genes up in the experiment's published table.

/**
 * One gene in one tissue, as the table publishes it: five numbers, the
 * minimum, lower quartile, median, upper quartile and maximum TPM across the
 * tissue's samples. With one sample all five are that sample's value. A list
 * rather than a tuple: the description's validator (JSON Schema 2020-12)
 * refused the tuple's generated schema.
 */
export type Quantiles = number[];

/** A column: the table's group id, its label, how many samples it holds, and its anatomy id. */
export interface ExpressionTissue {
  id: string;
  label: string;
  samples: number;
  /** Its UBERON id (UBERON_0002106 for spleen), which the anatomogram's organs carry. */
  uberon: string;
  /** Where an experiment measures each sex apart (rat): the sex of this column. */
  sex?: 'female' | 'male';
}

/** The experiment the values come from, with what the tab must say about it. */
export interface ExpressionExperiment {
  /** Expression Atlas's accession, such as E-MTAB-2836. */
  accession: string;
  title: string;
  /** One line for the tab: "29 tissues from 122 individuals". */
  design: string;
  species: string;
  /** The experiment's page on Expression Atlas. */
  source: string;
  /** When Expression Atlas last updated the experiment (ISO date). */
  updated: string;
  /** When the table was fetched from Expression Atlas (ISO date). */
  fetched: string;
  /** The citations its licence asks for. */
  citation: string[];
  licence: string;
  tissues: ExpressionTissue[];
}

/** One of the selection's entities, as the tab names it. */
export interface ExpressionEntity {
  /** UniProt accession, or Ensembl gene id for a gene. */
  identifier: string;
  stId: string;
  displayName: string;
}

/** One heatmap row: a gene, its values per tissue, and the entities that led to it. */
export interface ExpressionRow {
  /** Versionless Ensembl gene id. */
  gene: string;
  /** The table's gene name. */
  name: string;
  /** One per `experiment.tissues` entry; null where the table has no value. */
  values: (Quantiles | null)[];
  from: ExpressionEntity[];
}

/**
 * Why one of the selection's genes or gene products has no row: no Ensembl gene
 * and no name to match by; its gene is not in the experiment (Ensembl renamed
 * SOD2's after the table was built); the table has no value for it; or it is
 * another species' (HIV infection holds 9 HIV-1 proteins), whose expression
 * this experiment does not measure.
 */
type NotShownReason = 'no-gene' | 'not-in-experiment' | 'not-measured' | 'other-species';

export interface ExpressionNotShown extends ExpressionEntity {
  reason: NotShownReason;
}

/** How many of the selection's genes and gene products have a row. */
interface ExpressionCounts {
  shown: number;
  genes: number;
}

interface ExpressionHeatmap {
  kind: 'heatmap';
  experiment: ExpressionExperiment;
  /** In the service's order: genes expressed alike side by side. */
  rows: ExpressionRow[];
  notShown: ExpressionNotShown[];
  counts: ExpressionCounts;
}

/** The selection has no genes or gene products: a chemical, say. */
interface ExpressionNoGenes {
  kind: 'no-genes';
  experiment: ExpressionExperiment;
}

/** No tissue experiment is listed for the selection's species. */
interface ExpressionSpeciesNotAvailable {
  kind: 'species-not-available';
  species: string;
}

export type ExpressionAnswer =
  ExpressionHeatmap | ExpressionNoGenes | ExpressionSpeciesNotAvailable;
