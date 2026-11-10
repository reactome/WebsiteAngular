/**
 * Writes the expression tables the Expression tab's heatmap is drawn from
 * (spec 024, research R4-R5): for each species in expression-species.json,
 * Expression Atlas's published table for its experiment, as one JSON file
 * named for the experiment, which the service reads from EXPRESSION_FILES.
 *
 * WHEN TO RUN IT: when Expression Atlas updates a listed experiment, or a
 * species is added to the list. Then restart the content service.
 *
 *   node tools/content-node/snapshot-expression.ts --out <dir> [--species "Homo sapiens"] [--source <dir>]
 *   node tools/content-node/snapshot-expression.ts --fixture <file> --source <dir>
 *
 * It refuses to write a file that does not match its source: the gene count,
 * the tissue count against both the table and the experiment's configuration,
 * every five values in order, and 20 cells read back against the table's text.
 * `--source` reads `<accession>-tpms.tsv`, `<accession>-configuration.xml` and
 * `<accession>-info.json` from a folder instead of fetching them; `--fixture`
 * cuts the few genes the specs use (FIXTURE_GENES) from the human table.
 */
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ExpressionTissue, Quantiles } from '../../projects/contract/expression.ts';
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
export function groupsOf(configuration: string): { id: string; label: string; samples: number }[] {
  const groups: { id: string; label: string; samples: number }[] = [];
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
    groups.push({
      id,
      label: decode(label),
      samples: [...(match[2] ?? '').matchAll(/<assay\b/g)].length,
    });
  }
  return groups;
}

/** A table cell, "min,q1,median,q3,max" or empty, as five numbers or null. */
export function cellOf(text: string): Quantiles | null {
  if (text === '') return null;
  const values = text.split(',').map(Number);
  return values.length === 5 && values.every((v) => Number.isFinite(v))
    ? (values as Quantiles)
    : null;
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
  fetched: string;
}): ExperimentFile {
  const { species, listed, info, table, configuration, fetched } = input;
  const [header = '', ...lines] = table.split('\n').filter((line) => line.trim() !== '');
  const columns = header.split('\t');
  if (columns[0] !== 'GeneID' || columns[1] !== 'Gene Name')
    throw new Error(`unexpected table header: ${columns.slice(0, 3).join(', ')}`);
  const groups = new Map(groupsOf(configuration).map((group) => [group.id, group]));
  const tissues: ExpressionTissue[] = columns.slice(2).map((id) => {
    const group = groups.get(id);
    if (!group) throw new Error(`column ${id} is not a group in the configuration`);
    return { id, label: group.label, samples: group.samples };
  });
  const order = tissues
    .map((_, i) => i)
    .sort((a, b) => (tissues[a]?.label ?? '').localeCompare(tissues[b]?.label ?? ''));
  const genes: Record<string, ExperimentGene> = {};
  for (const line of lines) {
    const cells = line.split('\t');
    const id = cells[0] ?? '';
    if (genes[id]) throw new Error(`${id} appears twice`);
    genes[id] = { name: cells[1] ?? '', values: order.map((i) => cellOf(cells[i + 2] ?? '')) };
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
  cells = 20
): string[] {
  const problems = problemsOf(file);
  const lines = table.split('\n').filter((line) => line.trim() !== '');
  const columns = (lines[0] ?? '').split('\t').slice(2);
  const rows = lines.length - 1;
  const genes = Object.keys(file.genes).length;
  if (genes !== rows) problems.push(`${genes} genes written for ${rows} in the table`);
  const groups = groupsOf(configuration).length;
  if (file.tissues.length !== columns.length)
    problems.push(`${file.tissues.length} tissues written for ${columns.length} columns`);
  if (columns.length !== groups)
    problems.push(`${columns.length} columns for ${groups} groups in the configuration`);
  if (!file.design.startsWith(`${file.tissues.length} `))
    problems.push(`the design line "${file.design}" does not name ${file.tissues.length} tissues`);
  const next = sampler(rows * 31 + columns.length);
  for (let n = 0; n < cells && rows > 0 && columns.length > 0; n++) {
    const source = (lines[1 + next(rows)] ?? '').split('\t');
    const column = next(columns.length);
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
      info: JSON.parse(read('info.json')) as AtlasInfo,
    };
  }
  const base = `${FTP}/${accession}/${accession}`;
  return {
    table: await fetchText(`${base}-tpms.tsv`),
    configuration: await fetchText(`${base}-configuration.xml`),
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
  const only = option('--species') ?? (fixture ? 'Homo sapiens' : undefined);
  if (!out && !fixture) throw new Error('say where to write: --out <dir> or --fixture <file>');
  const fetched = new Date().toISOString().slice(0, 10);
  let failed = false;
  for (const [species, listed] of Object.entries(listedSpecies())) {
    if (only && species !== only) continue;
    const { table, configuration, info } = await sourcesFor(listed.accession, source);
    if (info.experimentAccession !== listed.accession || info.species !== species)
      throw new Error(
        `${listed.accession}: Expression Atlas describes ${info.experimentAccession} in ${info.species}`
      );
    const file = buildExperiment({ species, listed, info, table, configuration, fetched });
    const problems = checkAgainstSource(file, table, configuration);
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
