/**
 * Which of an experiment's genes a selection's reference entities are (spec
 * 024, research R2): the matching rules, with nothing read here. Reactome's
 * own `referenceGene` links found the gene of 98.96% of the 11,494 human gene
 * products in E-MTAB-2836's table, and its gene names a further 0.6%: Ensembl
 * gave genes such as SOD2 a new id after the table was built (Reactome names
 * ENSG00000291237, the table ENSG00000112096), which only the name still finds.
 */
import type { ExpressionEntity, ExpressionNotShown } from '../../projects/contract/expression.ts';
import type { LoadedExperiment } from './expression-data.ts';

/** One reference entity of the selection, with what the graph says of its gene. */
export interface SelectionEntity {
  stId: string;
  displayName: string;
  /** UniProt accession (an isoform carries its parent's), or a gene's own id. */
  identifier: string;
  schemaClass: string;
  geneName: string[];
  /** Its `referenceGene` links' Ensembl identifiers. */
  ensemblGenes: string[];
  /** Its own species, where it has one (chemicals have none). */
  species?: string | null;
}

/** A gene the selection has, by its row in the experiment. */
interface MatchedGene {
  row: number;
  from: ExpressionEntity[];
}

export interface Matched {
  genes: MatchedGene[];
  notShown: ExpressionNotShown[];
  /** The selection's distinct genes and gene products: what "N of M" counts. */
  counted: number;
}

/** The reference entities that are genes or their products; chemicals and drugs are not. */
const GENES = new Set([
  'ReferenceGeneProduct',
  'ReferenceIsoform',
  'ReferenceDNASequence',
  'ReferenceRNASequence',
]);

const ENSEMBL_GENE = /^(ENS[A-Z]*G\d+)(\.\d+)?$/;

/** The versionless Ensembl gene id, or nothing for anything else. */
const ensemblGene = (id: string) => ENSEMBL_GENE.exec(id)?.[1];

/** Rows whose values are all missing: in the table, but not measured. */
function measured(loaded: LoadedExperiment, row: number): boolean {
  const width = loaded.experiment.tissues.length * 5;
  for (let i = row * width; i < (row + 1) * width; i++)
    if (!Number.isNaN(loaded.values[i])) return true;
  return false;
}

/**
 * The rules, in order:
 * 1. a gene's own Ensembl id, and a product's `referenceGene` Ensembl ids,
 *    kept if the table has them;
 * 2. of several, the one the product's gene name names, alone (MSH5 and the
 *    MSH5-SAPCD1 readthrough share a product), else every one (DEFB4A and
 *    DEFB4B are one protein's two genes);
 * 3. with none, a gene name that names exactly one gene in the table;
 * 4. each gene once, `from` listing every entity that led to it.
 * An isoform shares its parent's accession, so the two are one product.
 */
export function matchGenes(entities: SelectionEntity[], loaded: LoadedExperiment): Matched {
  const drawn = loaded.experiment.species;
  const products = new Map<string, SelectionEntity[]>();
  for (const entity of entities) {
    if (!GENES.has(entity.schemaClass)) continue;
    products.set(entity.identifier, [...(products.get(entity.identifier) ?? []), entity]);
  }

  const genes = new Map<number, MatchedGene>();
  const notShown: ExpressionNotShown[] = [];
  for (const [identifier, sharing] of products) {
    const [first] = sharing;
    if (!first) continue;
    const named = (entity: SelectionEntity): ExpressionEntity => ({
      identifier,
      stId: entity.stId,
      displayName: entity.displayName,
    });
    // Another species' product is never drawn with this experiment's data, not
    // even by a gene name the two species happen to share (FR-010).
    if (sharing.some((entity) => entity.species && entity.species !== drawn)) {
      notShown.push({ ...named(first), reason: 'other-species' });
      continue;
    }
    const linked = new Set<string>();
    const names = new Set<string>();
    for (const entity of sharing) {
      for (const id of [entity.identifier, ...entity.ensemblGenes]) {
        const gene = ensemblGene(id);
        if (gene) linked.add(gene);
      }
      for (const name of entity.geneName) names.add(name);
    }

    let rows = [...linked].flatMap((gene) => {
      const row = loaded.index.get(gene);
      return row === undefined ? [] : [row];
    });
    if (rows.length > 1) {
      const preferred = rows.filter((row) => names.has(loaded.names[row] ?? ''));
      if (preferred.length === 1) rows = preferred;
    }
    if (!rows.length) {
      for (const name of names) {
        const found = loaded.byName.get(name);
        if (found?.length === 1) {
          rows = found;
          break;
        }
      }
    }
    if (!rows.length) {
      notShown.push({ ...named(first), reason: linked.size ? 'not-in-experiment' : 'no-gene' });
      continue;
    }
    const kept = rows.filter((row) => measured(loaded, row));
    if (!kept.length) {
      notShown.push({ ...named(first), reason: 'not-measured' });
      continue;
    }
    for (const row of kept) {
      const gene = genes.get(row) ?? { row, from: [] };
      for (const entity of sharing)
        if (!gene.from.some((f) => f.stId === entity.stId)) gene.from.push(named(entity));
      genes.set(row, gene);
    }
  }
  return { genes: [...genes.values()], notShown, counted: products.size };
}
