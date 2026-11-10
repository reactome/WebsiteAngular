/**
 * The Expression tab's heatmap (spec 024): the genes of a selection -- a
 * pathway, reaction, complex, set, protein or reference entity -- across the
 * tissues of its species' experiment, from Expression Atlas's published table
 * (expression-data.ts), ordered so that genes expressed alike sit together.
 *
 * Node's alone: Java has no such URL. The tab embedded Expression Atlas's
 * widget, which ignores the genes it is asked about (asked for BCL2 or a
 * pathway, it drew the same 29 of 9,570 default genes), so the genes are found
 * here, from the graph, and looked up in the table.
 */
import type { ExpressionAnswer, ExpressionRow } from '../../projects/contract/expression.ts';
import { javaError, notFound } from './answers.ts';
import type { Endpoint, Request } from './endpoint.ts';
import { experimentFor, valuesAt } from './expression-data.ts';
import type { Experiment, LoadedExperiment } from './expression-data.ts';
import { matchGenes } from './expression-genes.ts';
import type { SelectionEntity } from './expression-genes.ts';
import { orderRows } from './expression-order.ts';
import { read } from './graph.ts';
import { graphCoreId } from './objects.ts';
import type { Props } from './objects.ts';
import { pathId, rawSegment } from './spring.ts';

/** What the graph says of the selection: its species, and its reference entities. */
export interface Selection {
  species: string | null;
  entities: (SelectionEntity & { species: string | null })[];
}

/** The ReferenceEntity classes, most specific first (as reference-entities.ts reads them). */
const CLASSES = [
  'ReferenceIsoform',
  'ReferenceGeneProduct',
  'ReferenceDNASequence',
  'ReferenceRNASequence',
  'ReferenceTherapeutic',
  'ReferenceMolecule',
];

/**
 * The selection and the reference entities beneath it, by the path
 * /data/participants/{id}/referenceEntities follows, and the selection itself
 * when it is one (zero steps); each with its gene name and its `referenceGene`
 * links' Ensembl ids. Undefined when there is no such object.
 */
async function selectionOf(raw: string): Promise<Selection | undefined> {
  const id = await graphCoreId(pathId(raw));
  if (!id) return undefined;
  const rows = await read<{
    species: string | null;
    m: Props | null;
    labels: string[] | null;
    genes: string[];
    mSpecies: string | null;
  }>(
    `MATCH (n:DatabaseObject${id.object})
     OPTIONAL MATCH (n)-[:species]->(s:Species)
     WITH n, coalesce(n.speciesName, head(collect(s.displayName))) AS species
     OPTIONAL MATCH (n)-[:hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|referenceEntity|proteinMarker|RNAMarker*0..]->(m:ReferenceEntity)
     WITH species, collect(DISTINCT m) AS found
     UNWIND (CASE WHEN size(found) = 0 THEN [null] ELSE found END) AS m
     OPTIONAL MATCH (m)-[:referenceGene]->(g:ReferenceDNASequence {databaseName: 'ENSEMBL'})
     OPTIONAL MATCH (m)-[:species]->(ms:Species)
     RETURN species, m, labels(m) AS labels, collect(DISTINCT g.identifier) AS genes, head(collect(ms.displayName)) AS mSpecies`,
    id.params
  );
  if (!rows.length) return undefined;
  const entities = rows.flatMap((row) => {
    const node = row.m;
    if (!node) return [];
    const geneName = node['geneName'];
    return [
      {
        stId: String(node['stId'] ?? ''),
        displayName: String(node['displayName'] ?? ''),
        identifier: String(node['identifier'] ?? ''),
        schemaClass: CLASSES.find((name) => row.labels?.includes(name)) ?? 'ReferenceEntity',
        geneName: Array.isArray(geneName) ? geneName.map(String) : [],
        ensemblGenes: row.genes,
        species: row.mSpecies,
      },
    ];
  });
  return { species: rows[0]?.species ?? null, entities };
}

/** The species to draw: the selection's, else its genes' most common, else human. */
function speciesOf(selection: Selection): string {
  if (selection.species) return selection.species;
  const counts = new Map<string, number>();
  for (const entity of selection.entities)
    if (entity.species) counts.set(entity.species, (counts.get(entity.species) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Nothing carries a species only when the selection is chemicals alone,
  // which have no genes to draw in any species.
  return top?.[0] ?? 'Homo sapiens';
}

/** The answer for a selection and its species' experiment. */
export function answerFor(
  selection: Selection,
  experiment: Experiment
): ExpressionAnswer | { unavailable: string } {
  const species = speciesOf(selection);
  if (experiment.kind === 'not-listed') return { kind: 'species-not-available', species };
  if (experiment.kind === 'unavailable') return { unavailable: experiment.why };
  const { loaded } = experiment;
  const matched = matchGenes(selection.entities, loaded);
  if (!matched.counted) return { kind: 'no-genes', experiment: loaded.experiment };
  const rows = matched.genes.map(({ row, from }) => rowOf(loaded, row, from));
  const order = orderRows(
    rows.map((row) => ({
      name: row.name,
      gene: row.gene,
      medians: row.values.map((cell) => cell?.[2] ?? NaN),
    }))
  );
  return {
    kind: 'heatmap',
    experiment: loaded.experiment,
    rows: order.flatMap((i) => rows[i] ?? []),
    notShown: matched.notShown,
    counts: { shown: matched.counted - matched.notShown.length, genes: matched.counted },
  };
}

function rowOf(loaded: LoadedExperiment, row: number, from: ExpressionRow['from']): ExpressionRow {
  return {
    gene: loaded.ids[row] ?? '',
    name: loaded.names[row] ?? '',
    values: valuesAt(loaded, row),
    from,
  };
}

async function handler(request: Request) {
  const selection = await selectionOf(rawSegment(request, 3));
  if (!selection) return notFound(request, 'No entries found for the given identifier');
  const species = speciesOf(selection);
  const answer = answerFor(selection, experimentFor(species));
  if ('unavailable' in answer) {
    console.error(`expression data unavailable for ${species}: ${answer.unavailable}`);
    return javaError(request, 503, 'SERVICE_UNAVAILABLE', 'Expression data is not available');
  }
  return { status: 200, type: 'application/json', body: answer satisfies ExpressionAnswer };
}

export const expressionEndpoints: Endpoint[] = [
  {
    path: '/ContentService/expression/{id}',
    // No sample: Java has no such URL, so the parity harness has nothing to
    // compare it with. expression-endpoints.spec.ts holds it.
    samplesOnly: true,
    handler,
  },
];
