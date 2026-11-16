/**
 * Writes the expression tables the Expression tab's heatmap is drawn from
 * (spec 024, research R4-R5): for each species in expression-species.json,
 * Expression Atlas's published table for its experiment, as one JSON file
 * named for the experiment, which the service reads from EXPRESSION_FILES.
 *
 * WHEN TO RUN IT: when Expression Atlas updates a listed experiment, or a
 * species is added to the list. Then restart the content service, and purge
 * the edge cache of /ContentService/expression/*: its answers are stored at
 * the edge as the service's others are, until the next release's purge.
 *
 *   node tools/content-node/snapshot-expression.ts --out <dir> [--species "Homo sapiens"] [--source <dir>]
 *   node tools/content-node/snapshot-expression.ts --fixture <file> --source <dir>
 *   node tools/content-node/snapshot-expression.ts --compare <base URL> [--id <stId>]
 *
 * It refuses to write a file that does not match its source: the gene count,
 * the tissue count against both the table and the experiment's configuration,
 * every five values in order, and 20 cells read back against the table's text.
 * `--source` reads `<accession>-tpms.tsv`, `<accession>-configuration.xml`,
 * `<accession>.condensed-sdrf.tsv` and `<accession>-info.json` from a folder
 * instead of fetching them; `--fixture`
 * cuts the few genes the specs use (FIXTURE_GENES) from the human table;
 * run Prettier on the fixture after, as the format check holds it to Prettier's
 * layout.
 */
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  ExpressionAnswer,
  ExpressionTissue,
  Quantiles,
} from '../../projects/contract/expression.ts';

type ExpressionHeatmap = Extract<ExpressionAnswer, { kind: 'heatmap' }>;
import { listedSpecies, problemsOf } from './expression-data.ts';
import type { ExperimentFile, ExperimentGene, ListedSpecies } from './expression-data.ts';

const FTP = 'https://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments';
const ATLAS = 'https://www.ebi.ac.uk/gxa';

/** What Expression Atlas says of an experiment (/gxa/json/experiments/{acc}/info). */
export interface AtlasInfo {
  experimentAccession: string;
  experimentDescription: string;
  species: string;
  lastUpdate: string;
}

/** A configuration's tissue groups: id, label, and the assays in each. */
export function groupsOf(
  configuration: string
): { id: string; label: string; samples: number; assays: string[] }[] {
  const groups: { id: string; label: string; samples: number; assays: string[] }[] = [];
  const decode = (text: string) =>
    text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  for (const match of configuration.matchAll(/<assay_group\b([^>]*)>([\s\S]*?)<\/assay_group>/g)) {
    const attributes = match[1] ?? '';
    const id = /\bid="([^"]*)"/.exec(attributes)?.[1];
    const label = /\blabel="([^"]*)"/.exec(attributes)?.[1];
    if (!id || label === undefined) continue;
    const assays = [...(match[2] ?? '').matchAll(/<assay\b[^>]*>([^<]*)<\/assay>/g)].map((assay) =>
      (assay[1] ?? '').trim()
    );
    groups.push({ id, label: decode(label), samples: assays.length, assays });
  }
  return groups;
}

/**
 * Each assay's anatomy id, from the experiment's condensed sample file: the
 * UBERON id of its "organism part" factor (spec 024, research R10).
 */
export function anatomyOf(sdrf: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const line of sdrf.split('\n')) {
    const cells = line.split('\t');
    if (cells[3] === 'factor' && cells[4] === 'organism part' && cells[2]) {
      const id = (cells[6] ?? '').split('/').pop() ?? '';
      if (!/^UBERON_\d+$/.test(id)) continue;
      const known = ids.get(cells[2]);
      if (known && known !== id)
        throw new Error(`assay ${cells[2]} names two anatomy ids: ${known}, ${id}`);
      ids.set(cells[2], id);
    }
  }
  return ids;
}

/**
 * A table cell, "min,q1,median,q3,max" or empty, as five numbers or null.
 * Anything else is refused, not read as "no value": a column of another form
 * would otherwise be written as empty, and 20 sampled cells miss one column in
 * 29 about half the time.
 */
export function cellOf(text: string): Quantiles | null {
  if (text === '') return null;
  const values = text.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
  if (values.length !== 5 || !values.every((v) => Number.isFinite(v)))
    throw new Error(`"${text}" is not five numbers`);
  return values;
}

/**
 * A multi-factor group's label, "adult; liver; female": its stage, organ and
 * sex. Rat's experiment crosses four stages with organs and sex; only one
 * stage is kept (expression-species.json's `stage`).
 */
export function stageOf(label: string): { stage: string; organ: string; sex?: 'female' | 'male' } {
  const [stage = '', organ = '', sex] = label.split('; ');
  return { stage, organ, ...((sex === 'female' || sex === 'male') && { sex }) };
}

/** Expression Atlas's dates are day-month-year; the file's are ISO. */
const isoDate = (atlas: string) => {
  const [day, month, year] = atlas.split('-');
  return `${year}-${month}-${day}`;
};

/**
 * An experiment file from its sources. Tissues are in label order, as
 * Expression Atlas shows them; genes keep the table's values exactly.
 */
export function buildExperiment(input: {
  species: string;
  listed: ListedSpecies;
  info: AtlasInfo;
  table: string;
  configuration: string;
  /** The condensed sample file, for each tissue's anatomy id. */
  sdrf: string;
  fetched: string;
}): ExperimentFile {
  const { species, listed, info, table, configuration, sdrf, fetched } = input;
  const anatomy = anatomyOf(sdrf);
  const [header = '', ...lines] = table.split('\n').filter((line) => line.trim() !== '');
  const columns = header.split('\t');
  if (columns[0] !== 'GeneID' || columns[1] !== 'Gene Name')
    throw new Error(`unexpected table header: ${columns.slice(0, 3).join(', ')}`);
  const groups = new Map(groupsOf(configuration).map((group) => [group.id, group]));
  for (const id of columns.slice(2))
    if (!groups.has(id)) throw new Error(`column ${id} is not a group in the configuration`);
  // The columns kept, with where each is in a row: all of them, or one stage's.
  const kept = columns
    .slice(2)
    .map((id, at) => ({ id, at, group: groups.get(id) }))
    .filter(({ group }) => !listed.stage || stageOf(group?.label ?? '').stage === listed.stage);
  const tissues: ExpressionTissue[] = kept.map(({ id, group }) => {
    if (!group) throw new Error(`column ${id} is not a group in the configuration`);
    // One anatomy id per tissue: a group whose samples name two is two tissues.
    const ids = new Set(group.assays.flatMap((assay) => anatomy.get(assay) ?? []));
    const [uberon] = ids;
    if (ids.size !== 1 || !uberon)
      throw new Error(`${group.label} (${id}) has ${ids.size} anatomy ids: ${[...ids].join(', ')}`);
    if (!listed.stage) return { id, label: group.label, samples: group.samples, uberon };
    const { organ, sex } = stageOf(group.label);
    return {
      id,
      label: sex ? `${organ} (${sex})` : organ,
      samples: group.samples,
      uberon,
      ...(sex && { sex }),
    };
  });
  // Two tissues on one organ, of one sex: the anatomogram could draw only one.
  const seen = new Map<string, string>();
  for (const tissue of tissues) {
    const key = `${tissue.uberon} ${tissue.sex ?? ''}`;
    const other = seen.get(key);
    if (other) throw new Error(`${other} and ${tissue.label} are both ${tissue.uberon}`);
    seen.set(key, tissue.label);
  }
  const order = tissues
    .map((_, i) => i)
    .sort((a, b) => (tissues[a]?.label ?? '').localeCompare(tissues[b]?.label ?? ''));
  const genes: Record<string, ExperimentGene> = {};
  for (const line of lines) {
    const cells = line.split('\t');
    const id = cells[0] ?? '';
    if (cells.length !== columns.length)
      throw new Error(`${id} has ${cells.length} cells for ${columns.length} columns`);
    if (genes[id]) throw new Error(`${id} appears twice`);
    genes[id] = {
      name: cells[1] ?? '',
      values: order.map((i) => cellOf(cells[(kept[i]?.at ?? -3) + 2] ?? '')),
    };
  }
  return {
    accession: listed.accession,
    title: info.experimentDescription,
    design: listed.design,
    species,
    source: `${ATLAS}/experiments/${listed.accession}`,
    updated: isoDate(info.lastUpdate),
    fetched,
    citation: listed.citation,
    licence: listed.licence,
    tissues: order.flatMap((i) => tissues[i] ?? []),
    genes,
  };
}

/** A small deterministic generator, so the cells checked are the same each run. */
function sampler(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

/**
 * Why a built file must not be written, if anything: what problemsOf finds,
 * and any count or sampled cell that differs from the sources. The cells are
 * read back from the table's own text, not from what was parsed, so a
 * misparse cannot agree with itself.
 */
export function checkAgainstSource(
  file: ExperimentFile,
  table: string,
  configuration: string,
  cells = 20,
  stage?: string
): string[] {
  const problems = problemsOf(file);
  const lines = table.split('\n').filter((line) => line.trim() !== '');
  const columns = (lines[0] ?? '').split('\t').slice(2);
  const rows = lines.length - 1;
  const genes = Object.keys(file.genes).length;
  if (genes !== rows) problems.push(`${genes} genes written for ${rows} in the table`);
  const all = groupsOf(configuration);
  const groups = all.length;
  const labels = new Map(all.map((group) => [group.id, group.label]));
  const keptColumns = columns.filter(
    (id) => !stage || stageOf(labels.get(id) ?? '').stage === stage
  );
  if (file.tissues.length !== keptColumns.length)
    problems.push(`${file.tissues.length} tissues written for ${keptColumns.length} columns`);
  if (columns.length !== groups)
    problems.push(`${columns.length} columns for ${groups} groups in the configuration`);
  if (!file.design.startsWith(`${file.tissues.length} `))
    problems.push(`the design line "${file.design}" does not name ${file.tissues.length} tissues`);
  // "3 samples each" and "20 samples" are checked against the tissues too.
  const each = /(\d+) samples each/.exec(file.design)?.[1];
  if (each && file.tissues.some((tissue) => tissue.samples !== Number(each)))
    problems.push(`the design line says ${each} samples each, the tissues do not all have ${each}`);
  const total = /(\d+) samples(?! each)/.exec(file.design)?.[1];
  const sum = file.tissues.reduce((n, tissue) => n + tissue.samples, 0);
  if (total && Number(total) !== sum)
    problems.push(`the design line says ${total} samples, the tissues hold ${sum}`);
  const next = sampler(rows * 31 + columns.length);
  for (let n = 0; n < cells && rows > 0 && columns.length > 0; n++) {
    const source = (lines[1 + next(rows)] ?? '').split('\t');
    const column = columns.indexOf(keptColumns[next(keptColumns.length)] ?? '');
    const id = source[0] ?? '';
    const tissue = file.tissues.findIndex((t) => t.id === columns[column]);
    const written = file.genes[id]?.values[tissue];
    const text = source[column + 2] ?? '';
    const expected = text === '' ? null : text.split(',').map(Number);
    const same =
      expected === null
        ? written === null
        : !!written &&
          written.length === expected.length &&
          written.every((v, i) => v === expected[i]);
    if (!same)
      problems.push(
        `${id} in ${columns[column]}: wrote ${JSON.stringify(written)}, the table has "${text}"`
      );
  }
  return problems;
}

/**
 * A live heatmap's values against the experiment's own published table (spec
 * 024, SC-003): `cells` gene and tissue pairs sampled from the answer, each
 * read back from the table's text. Empty when every one matches. It checks
 * what a reader is shown, end to end: the refresh step, the file, the
 * service and its routing.
 */
export function compareAnswer(answer: ExpressionHeatmap, table: string, cells = 20): string[] {
  const lines = table.split('\n').filter((line) => line.trim() !== '');
  const columns = (lines[0] ?? '').split('\t');
  const byGene = new Map(
    lines.slice(1).map((line) => [line.split('\t')[0] ?? '', line.split('\t')])
  );
  const tissues = answer.experiment.tissues;
  const pairs = answer.rows.flatMap((row) => tissues.map((tissue, t) => ({ row, tissue, t })));
  if (!pairs.length) return ['the answer has no values to compare'];
  const problems: string[] = [];
  const next = sampler(pairs.length);
  for (let n = 0; n < Math.min(cells, pairs.length); n++) {
    const pick = pairs[next(pairs.length)];
    if (!pick) continue;
    const { row, tissue, t } = pick;
    const source = byGene.get(row.gene);
    if (!source) {
      problems.push(`${row.gene} (${row.name}) is not in the table`);
      continue;
    }
    const text = source[columns.indexOf(tissue.id)] ?? '';
    const expected = text === '' ? null : text.split(',').map(Number);
    const shown = row.values[t] ?? null;
    const same =
      expected === null
        ? shown === null
        : !!shown && shown.length === expected.length && shown.every((v, i) => v === expected[i]);
    if (!same)
      problems.push(
        `${row.name} in ${tissue.label}: shown ${JSON.stringify(shown)}, the table has "${text}"`
      );
  }
  return problems;
}

/** The genes the specs and e2e need, cut from the human table (spec 024, T011). */
export const FIXTURE_GENES = [
  'ENSG00000171791', // BCL2
  'ENSG00000087088', // BAX
  'ENSG00000132906', // CASP9
  'ENSG00000141510', // TP53
  'ENSG00000105327', // BBC3
  'ENSG00000112096', // SOD2: Reactome now names ENSG00000291237, not in the table
  'ENSG00000171711', // DEFB4A
  'ENSG00000177257', // DEFB4B
  'ENSG00000204410', // MSH5
  'ENSG00000255152', // MSH5-SAPCD1
  'ENSG00000002330', // BAD
  'ENSG00000153094', // BCL2L11 (BIM)
  'ENSG00000002834', // LASP1
  'ENSG00000000003', // TSPAN6
  'ENSG00000105371', // ICAM4: zero in every tissue
];

/** The fixture: the full file's description with only FIXTURE_GENES. */
export function fixtureOf(file: ExperimentFile): ExperimentFile {
  const genes: Record<string, ExperimentGene> = {};
  for (const id of FIXTURE_GENES) {
    const gene = file.genes[id];
    if (!gene) throw new Error(`${id} is not in ${file.accession}`);
    genes[id] = gene;
  }
  return { ...file, genes };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function sourcesFor(accession: string, folder?: string) {
  if (folder) {
    const read = (name: string) => readFileSync(join(folder, `${accession}-${name}`), 'utf8');
    return {
      table: read('tpms.tsv'),
      configuration: read('configuration.xml'),
      sdrf: readFileSync(join(folder, `${accession}.condensed-sdrf.tsv`), 'utf8'),
      info: JSON.parse(read('info.json')) as AtlasInfo,
    };
  }
  const base = `${FTP}/${accession}/${accession}`;
  return {
    table: await fetchText(`${base}-tpms.tsv`),
    configuration: await fetchText(`${base}-configuration.xml`),
    sdrf: await fetchText(`${base}.condensed-sdrf.tsv`),
    info: JSON.parse(await fetchText(`${ATLAS}/json/experiments/${accession}/info`)) as AtlasInfo,
  };
}

/** Write through a temporary name, so a reader never sees half a file. */
function writeWhole(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.part`, text);
  renameSync(`${path}.part`, path);
}

async function main(args: string[]) {
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const out = option('--out');
  const fixture = option('--fixture');
  const source = option('--source');
  const compare = option('--compare');
  if (compare) return compareLive(compare, option('--id') ?? 'R-HSA-109606', source);
  const only = option('--species') ?? (fixture ? 'Homo sapiens' : undefined);
  if (!out && !fixture) throw new Error('say where to write: --out <dir> or --fixture <file>');
  const fetched = new Date().toISOString().slice(0, 10);
  let failed = false;
  for (const [species, listed] of Object.entries(listedSpecies())) {
    if (only && species !== only) continue;
    const { table, configuration, sdrf, info } = await sourcesFor(listed.accession, source);
    if (info.experimentAccession !== listed.accession || info.species !== species)
      throw new Error(
        `${listed.accession}: Expression Atlas describes ${info.experimentAccession} in ${info.species}`
      );
    const file = buildExperiment({
      species,
      listed,
      info,
      table,
      configuration,
      sdrf,
      fetched,
    });
    const problems = checkAgainstSource(file, table, configuration, 20, listed.stage);
    if (problems.length) {
      failed = true;
      console.error(
        `${listed.accession} (${species}): not written\n  ${problems.slice(0, 10).join('\n  ')}`
      );
      continue;
    }
    const text = JSON.stringify(fixture ? fixtureOf(file) : file);
    if (JSON.stringify(JSON.parse(text)) !== text)
      throw new Error(`${listed.accession} does not round-trip`);
    const path = fixture ?? join(out ?? '.', `${listed.accession}.json`);
    writeWhole(path, fixture ? `${JSON.stringify(fixtureOf(file), null, 1)}\n` : text);
    console.log(
      `${listed.accession} (${species}): ${Object.keys(file.genes).length} genes, ${file.tissues.length} tissues, ` +
        `20 cells match the table; wrote ${path} (${(text.length / 1e6).toFixed(1)} MB)`
    );
  }
  if (failed) process.exitCode = 1;
}

/**
 * `--compare <base URL> [--id <stId>]`: the service's answer for a selection
 * against its species' published table. Exits non-zero on any difference.
 */
async function compareLive(base: string, id: string, source?: string) {
  const url = `${base.replace(/\/$/, '')}/ContentService/expression/${id}`;
  const answer = JSON.parse(await fetchText(url)) as ExpressionAnswer;
  if (answer.kind !== 'heatmap') throw new Error(`${url} answers ${answer.kind}, not a heatmap`);
  const listed = listedSpecies()[answer.experiment.species];
  if (listed?.accession !== answer.experiment.accession)
    throw new Error(`${url} draws ${answer.experiment.accession}, not the listed experiment`);
  const { table } = await sourcesFor(answer.experiment.accession, source);
  const problems = compareAnswer(answer, table);
  if (problems.length) {
    process.exitCode = 1;
    console.error(
      `${id}: ${problems.length} of 20 cells differ from ${listed.accession}\n  ${problems.join('\n  ')}`
    );
  } else
    console.log(
      `${id}: 20 cells of ${answer.rows.length} genes match ${listed.accession}'s published table`
    );
}

/**
 * Run, not imported: compared as real paths, as scripts/is-entry.mjs does (the
 * service may import nothing outside this directory), since a path through a
 * symlink would otherwise never match and the step would silently do nothing.
 */
function isEntry(): boolean {
  try {
    return (
      !!process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
