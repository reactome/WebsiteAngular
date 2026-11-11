/**
 * Each pathway's size as the AnalysisService's hierarchy holds it (spec 006
 * T103a, research D25): `totalEntity`, the distinct identifiers its reactions
 * reach, and `totalEntityAndInteractors`, those with their interaction
 * partners, each counted per resource and its subpathways' included.
 * /data/eventsHierarchy writes them; Java reads them from the AnalysisService's
 * data file, which analysis-core builds from the graph as this does:
 *
 * - The tree: each top-level pathway of the species, then every Pathway below
 *   it through hasEvent (HierarchyBuilder.fillBranch). A pathway's size is its
 *   own reactions' identifiers and its subpathways', so it is the same under
 *   any parent.
 * - Entities: from each reaction a species pathway holds directly, the
 *   physical entities it reaches with a reference entity, by the relationships
 *   EntitiesBuilder follows; each one's (resource, variant identifier or
 *   identifier).
 * - Interactors: from the narrower set InteractorsBuilder follows, pathways
 *   under a top-level pathway only, each target's interaction partners, filed
 *   under the target's resource.
 * - Resources: ResourceFactory's main and auxiliary ones, under its
 *   equivalences; any other is not counted.
 *
 * One known difference (research D25): analysis-core merges a partner whose
 * identifier is another interactor's alias into that interactor
 * (reactome/analysis-core#13), so 79 human pathways' totalEntityAndInteractors
 * are one or two lower in Java than here. Computed once per species while the
 * process lives: the graph is a release's, and changes only with it.
 */
import { read } from './graph.ts';

export interface AnalysisSize {
  totalEntity: number;
  totalEntityAndInteractors: number;
}

/** ResourceFactory.MAIN and AUX: the resources a size counts. */
const COUNTED = new Set([
  'UNIPROT',
  'ENSEMBL',
  'MIRBASE',
  'CHEBI',
  'IUPHAR',
  'NCBI_NUCLEOTIDE',
  'NCBI_PROTEIN',
  'EMBL',
  'COMPOUND',
  'PUBCHEM_COMPOUND',
]);

/** ResourceFactory's equivalences that lead to a counted resource. */
const EQUIVALENT: Record<string, string> = {
  UNIPROTKB: 'UNIPROT',
  GENECARDS: 'UNIPROT',
  UCSC_HUMAN: 'UNIPROT',
  PRO: 'UNIPROT',
};

/**
 * ResourceFactory.getResource's name for a reference entity's databaseName,
 * if it is one a size counts: upper-cased, whitespace to underscores, then
 * its equivalence.
 */
export function countedResource(databaseName: string): string | undefined {
  const name = databaseName.toUpperCase().replace(/\s/g, '_').trim();
  const resource = EQUIVALENT[name] ?? name;
  return COUNTED.has(resource) ? resource : undefined;
}

/** The species' pathway tree, as parent → child pairs from its top-level pathways. */
const TREE_QUERY = `
MATCH (t:TopLevelPathway)-[:species]->(:Species {taxId: $taxId})
MATCH (t)-[:hasEvent*0..]->(p:Pathway)-[:hasEvent]->(c:Pathway)
RETURN DISTINCT p.stId AS parent, c.stId AS child
UNION
MATCH (t:TopLevelPathway)-[:species]->(:Species {taxId: $taxId})
RETURN t.stId AS parent, null AS child`;

/** EntitiesBuilder: each species pathway's own reactions' identifiers. */
const ENTITIES_QUERY = `
MATCH (:Species {taxId: $taxId})<-[:species]-(p:Pathway)-[:hasEvent]->(rle:ReactionLikeEvent),
      (rle)-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(:PhysicalEntity)-[:referenceEntity]->(re:ReferenceEntity)
WITH DISTINCT p, re
RETURN p.stId AS pathway, collect(DISTINCT [re.databaseName, coalesce(re.variantIdentifier, re.identifier)]) AS ids`;

/** InteractorsBuilder's targets: what a pathway's reactions reach that may interact. */
const TARGETS_QUERY = `
MATCH (:Species {taxId: $taxId})<-[:species]-(p:Pathway)-[:hasEvent]->(rle:ReactionLikeEvent),
      (rle)-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*]->(:PhysicalEntity)-[:referenceEntity]->(re:ReferenceEntity)
WHERE (p:TopLevelPathway) OR (:TopLevelPathway)-[:hasEvent*]->(p)
WITH DISTINCT p, [re.databaseName, coalesce(re.variantIdentifier, re.identifier)] AS target
RETURN p.stId AS pathway, collect(target) AS ids`;

/** InteractionsService.getInteractions(acc): each target's partners, by its identifier. */
const PARTNERS_QUERY = `
UNWIND $accs AS acc
MATCH (t:ReferenceEntity)<-[:interactor]-(:Interaction)-[:interactor]->(o:ReferenceEntity)
WHERE t.variantIdentifier = acc OR (t.variantIdentifier IS NULL AND t.identifier = acc)
RETURN acc, collect(DISTINCT coalesce(o.variantIdentifier, o.identifier)) AS partners`;

type IdRow = { pathway: string; ids: [string, string][] };

/** The tree's rows and the identifier rows, as computeSizes reads them. */
export interface SizeInputs {
  tree: { parent: string; child: string | null }[];
  entities: IdRow[];
  targets: IdRow[];
  partners: { acc: string; partners: string[] }[];
}

/** Every pathway's size in the tree the inputs describe, by stable id. */
export function computeSizes({ tree, entities, targets, partners }: SizeInputs) {
  const children = new Map<string, string[]>();
  for (const { parent, child } of tree) {
    const list = children.get(parent) ?? [];
    if (child !== null) {
      list.push(child);
      // A pathway with no subpathways is only ever a child here.
      if (!children.has(child)) children.set(child, []);
    }
    children.set(parent, list);
  }
  const partnersOf = new Map(partners.map((row) => [row.acc, row.partners]));
  const own = new Map<string, { entities: Set<string>; all: Set<string> }>();
  const ownOf = (pathway: string) => {
    let sets = own.get(pathway);
    if (!sets) own.set(pathway, (sets = { entities: new Set(), all: new Set() }));
    return sets;
  };
  for (const { pathway, ids } of entities) {
    const sets = ownOf(pathway);
    for (const [databaseName, id] of ids) {
      const resource = countedResource(databaseName);
      if (resource === undefined) continue;
      sets.entities.add(`${resource}|${id}`);
      sets.all.add(`${resource}|${id}`);
    }
  }
  for (const { pathway, ids } of targets) {
    const sets = ownOf(pathway);
    for (const [databaseName, id] of ids) {
      const resource = countedResource(databaseName);
      if (resource === undefined) continue;
      for (const partner of partnersOf.get(id) ?? []) sets.all.add(`${resource}|${partner}`);
    }
  }

  const done = new Map<string, { entities: Set<string>; all: Set<string> }>();
  const total = (pathway: string): { entities: Set<string>; all: Set<string> } => {
    const known = done.get(pathway);
    if (known) return known;
    const mine = own.get(pathway);
    const sets = { entities: new Set(mine?.entities), all: new Set(mine?.all) };
    for (const child of children.get(pathway) ?? []) {
      const below = total(child);
      for (const id of below.entities) sets.entities.add(id);
      for (const id of below.all) sets.all.add(id);
    }
    done.set(pathway, sets);
    return sets;
  };
  const sizes = new Map<string, AnalysisSize>();
  for (const pathway of children.keys()) {
    const { entities: e, all } = total(pathway);
    sizes.set(pathway, { totalEntity: e.size, totalEntityAndInteractors: all.size });
  }
  return sizes;
}

/** The graph's inputs for one species. */
async function sizeInputs(taxId: string): Promise<SizeInputs> {
  const [tree, entities, targets] = await Promise.all([
    read<SizeInputs['tree'][number]>(TREE_QUERY, { taxId }),
    read<IdRow>(ENTITIES_QUERY, { taxId }),
    read<IdRow>(TARGETS_QUERY, { taxId }),
  ]);
  const accs = [...new Set(targets.flatMap((row) => row.ids.map(([, id]) => id)))];
  const partners = await read<SizeInputs['partners'][number]>(PARTNERS_QUERY, { accs });
  return { tree, entities, targets, partners };
}

const bySpecies = new Map<string, Promise<Map<string, AnalysisSize>>>();

/**
 * Every pathway's size for a species, by taxId, computed once while the
 * process lives; a failed computation is tried again on the next call.
 */
export function analysisSizes(taxId: string): Promise<Map<string, AnalysisSize>> {
  let sizes = bySpecies.get(taxId);
  if (!sizes) {
    sizes = sizeInputs(taxId).then(computeSizes);
    sizes.catch(() => bySpecies.delete(taxId));
    bySpecies.set(taxId, sizes);
  }
  return sizes;
}
