/**
 * The expression tables the Expression tab's heatmap is drawn from (spec 024,
 * research R4-R5): one file per listed species, written by
 * snapshot-expression.ts, in a directory mounted read-only and named by
 * EXPRESSION_FILES, as the release's diagram files are. They are not in the
 * repository (the human table alone is 25 MB) nor in the image.
 *
 * A species not in expression-species.json has no experiment; a listed species
 * whose file is missing, or whose file does not hold together, is unavailable,
 * and never answered from another species' file.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExpressionExperiment,
  ExpressionTissue,
  Quantiles,
} from '../../projects/contract/expression.ts';

/** One gene's row in an experiment file. */
export interface ExperimentGene {
  /** The table's gene name, which may be empty. */
  name: string;
  /** One per tissue, in the experiment's order; null where the table has none. */
  values: (Quantiles | null)[];
}

/** An experiment file: the experiment's description and its genes by Ensembl id. */
export interface ExperimentFile extends ExpressionExperiment {
  genes: Record<string, ExperimentGene>;
}

/** What expression-species.json says of a species (the rest is fetched). */
export interface ListedSpecies {
  accession: string;
  design: string;
  citation: string[];
  licence: string;
}

let listed: Record<string, ListedSpecies> | undefined;

/**
 * The species list, read on first use: read on import, it broke every spec
 * that imports the registry in a browser-like environment, where the module's
 * URL is not a file.
 */
export const listedSpecies = (): Record<string, ListedSpecies> =>
  (listed ??= JSON.parse(
    readFileSync(new URL('./expression-species.json', import.meta.url), 'utf8')
  ) as Record<string, ListedSpecies>);

/**
 * An experiment as the service holds it: its description, and every value in
 * one array, five per tissue per gene. As plain objects the human table took
 * 184 MB of heap; packed, it is 61,860 x 29 x 5 doubles, 72 MB, with every
 * published value exact (single precision would turn 0.3 into 0.30000001).
 */
export interface LoadedExperiment {
  experiment: ExpressionExperiment;
  /** Row of each gene, by versionless Ensembl id. */
  index: Map<string, number>;
  /** The genes' Ensembl ids, by row. */
  ids: string[];
  /** The table's gene names, by row; repeated names are the table's. */
  names: string[];
  /** Rows of genes by name, for the gene-name fallback (spec 024, research R2). */
  byName: Map<string, number[]>;
  /** NaN where the table has no value. */
  values: Float64Array;
}

/** A gene's values, by row: five per tissue, null for a tissue with none. */
export function valuesAt(loaded: LoadedExperiment, row: number): (Quantiles | null)[] {
  const tissues = loaded.experiment.tissues.length;
  const cells: (Quantiles | null)[] = [];
  for (let t = 0; t < tissues; t++) {
    const at = (row * tissues + t) * 5;
    const cell = Array.from(loaded.values.subarray(at, at + 5)) as Quantiles;
    cells.push(Number.isNaN(cell[0]) ? null : cell);
  }
  return cells;
}

/** Packs a checked file (problemsOf found nothing). */
export function pack(file: ExperimentFile): LoadedExperiment {
  const { genes, ...experiment } = file;
  const ids = Object.keys(genes);
  const tissues = experiment.tissues.length;
  const values = new Float64Array(ids.length * tissues * 5);
  const index = new Map<string, number>();
  const names: string[] = [];
  const byName = new Map<string, number[]>();
  Object.values(genes).forEach((gene, row) => {
    const id = ids[row] ?? '';
    index.set(id, row);
    names.push(gene.name);
    if (gene.name) byName.set(gene.name, [...(byName.get(gene.name) ?? []), row]);
    gene.values.forEach((cell, t) =>
      values.set(cell ?? [NaN, NaN, NaN, NaN, NaN], (row * tissues + t) * 5)
    );
  });
  return { experiment, index, ids, names, byName, values };
}

export type Experiment =
  | { kind: 'experiment'; loaded: LoadedExperiment }
  | { kind: 'not-listed' }
  | { kind: 'unavailable'; why: string };

const isQuantiles = (value: unknown): value is Quantiles =>
  Array.isArray(value) &&
  value.length === 5 &&
  value.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) &&
  value.every((v, i) => i === 0 || (value[i - 1] as number) <= v);

/**
 * What is wrong with a parsed experiment file, if anything: an empty list when
 * it holds together. A tuple out of order is a column misread, not data
 * (min <= q1 <= median <= q3 <= max by definition).
 */
export function problemsOf(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object') return ['not an object'];
  const file = value as Partial<ExperimentFile>;
  for (const field of [
    'accession',
    'title',
    'design',
    'species',
    'source',
    'updated',
    'fetched',
    'licence',
  ] as const)
    if (typeof file[field] !== 'string' || !file[field]) problems.push(`no ${field}`);
  if (!Array.isArray(file.citation) || !file.citation.length) problems.push('no citation');
  const tissues = file.tissues;
  if (!Array.isArray(tissues) || !tissues.length) return [...problems, 'no tissues'];
  // Read as the file may be, not as the type says it is.
  (tissues as (Partial<ExpressionTissue> | null)[]).forEach((tissue, i) => {
    if (
      !tissue ||
      typeof tissue.id !== 'string' ||
      typeof tissue.label !== 'string' ||
      typeof tissue.uberon !== 'string' ||
      !/^UBERON_\d+$/.test(tissue.uberon) ||
      !((tissue.samples ?? 0) >= 1)
    )
      problems.push(`tissue ${i} is incomplete`);
  });
  const genes = file.genes;
  if (!genes || typeof genes !== 'object') return [...problems, 'no genes'];
  for (const [id, gene] of Object.entries(
    genes as Record<string, Partial<ExperimentGene> | null>
  )) {
    if (problems.length > 20) break;
    if (!/^ENS[A-Z]*G\d+$/.test(id)) problems.push(`${id} is not a versionless Ensembl gene id`);
    if (!gene || typeof gene.name !== 'string' || !Array.isArray(gene.values)) {
      problems.push(`${id} is incomplete`);
      continue;
    }
    if (gene.values.length !== tissues.length)
      problems.push(`${id} has ${gene.values.length} values for ${tissues.length} tissues`);
    gene.values.forEach((cell, i) => {
      if (cell !== null && !isQuantiles(cell))
        problems.push(`${id} in ${tissues[i]?.label ?? i} is not five ordered values`);
    });
  }
  return problems;
}

const loaded = new Map<string, { modified: number; answer: Experiment }>();

/**
 * The experiment for a species, loaded and checked on first use and kept: the
 * service is restarted when the files are refreshed, as for any data update.
 * A file that is there but wrong is kept as wrong until it changes, so that a
 * bad file costs one 28 MB read, not one per request; a missing one is looked
 * for again, as the folder may be mounted after the service starts.
 * `directory` defaults to EXPRESSION_FILES; tests pass their own.
 */
export function experimentFor(
  species: string,
  directory = process.env['EXPRESSION_FILES']
): Experiment {
  const entry = listedSpecies()[species];
  if (!entry) return { kind: 'not-listed' };
  if (!directory) return { kind: 'unavailable', why: 'no expression data directory is configured' };
  const path = join(directory, `${entry.accession}.json`);
  let modified: number;
  try {
    modified = statSync(path).mtimeMs;
  } catch (error) {
    return { kind: 'unavailable', why: `${entry.accession}: ${(error as Error).message}` };
  }
  const key = `${directory}\n${species}`;
  const known = loaded.get(key);
  if (known?.modified === modified) return known.answer;

  let answer: Experiment;
  try {
    const file: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const problems = problemsOf(file);
    if (problems.length)
      answer = {
        kind: 'unavailable',
        why: `${entry.accession}: ${problems.slice(0, 3).join('; ')}`,
      };
    else if (
      (file as ExperimentFile).accession !== entry.accession ||
      (file as ExperimentFile).species !== species
    )
      answer = { kind: 'unavailable', why: `${entry.accession}.json describes another experiment` };
    else answer = { kind: 'experiment', loaded: pack(file as ExperimentFile) };
  } catch (error) {
    answer = { kind: 'unavailable', why: `${entry.accession}: ${(error as Error).message}` };
  }
  loaded.set(key, { modified, answer });
  return answer;
}
