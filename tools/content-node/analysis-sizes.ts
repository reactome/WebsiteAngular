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
 * Entities and targets are read for the pathways in the tree, whatever their
 * own species: analysis-core attaches each pathway's counts to every place it
 * holds in any hierarchy (pathwayLocation, by dbId).
 *
 * One known difference (research D25): analysis-core merges a partner whose
 * identifier is another interactor's alias into that interactor
 * (reactome/analysis-core#13), so in release 98 76 human pathways'
 * totalEntityAndInteractors are 1 to 6 lower in Java than here, and 8 yeast
 * pathways' 1 lower; fixtures/analysis-size-differences.json records them.
 * Computed once per species while the process lives: the graph is a
 * release's, and changes only with it.
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

/** EntitiesBuilder: each tree pathway's own reactions' identifiers. */
const ENTITIES_QUERY = `
MATCH (p:Pathway)-[:hasEvent]->(rle:ReactionLikeEvent)
WHERE p.stId IN $pathways
MATCH (rle)-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(:PhysicalEntity)-[:referenceEntity]->(re:ReferenceEntity)
WITH DISTINCT p, re, collect(DISTINCT rle.dbId) AS reactions
RETURN p.stId AS pathway, collect([re.databaseName, coalesce(re.variantIdentifier, re.identifier), reactions]) AS ids`;

/** InteractorsBuilder's targets: what a tree pathway's reactions reach that may interact. */
const TARGETS_QUERY = `
MATCH (p:Pathway)-[:hasEvent]->(rle:ReactionLikeEvent)
WHERE p.stId IN $pathways
MATCH (rle)-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*]->(:PhysicalEntity)-[:referenceEntity]->(re:ReferenceEntity)
WITH DISTINCT p, re, collect(DISTINCT rle.dbId) AS reactions
RETURN p.stId AS pathway, collect([re.databaseName, coalesce(re.variantIdentifier, re.identifier), reactions]) AS ids`;

/** InteractionsService.getInteractions(acc): each target's partners, by its identifier. */
const PARTNERS_QUERY = `
UNWIND $accs AS acc
MATCH (t:ReferenceEntity)<-[:interactor]-(:Interaction)-[:interactor]->(o:ReferenceEntity)
WHERE t.variantIdentifier = acc OR (t.variantIdentifier IS NULL AND t.identifier = acc)
RETURN acc, collect(DISTINCT coalesce(o.variantIdentifier, o.identifier)) AS partners`;

/** A pathway's identifiers: database, identifier, and the reactions of the pathway that reach it. */
type IdRow = { pathway: string; ids: [string, string, (number | bigint)[]][] };

/** The tree's rows and the identifier rows, as computeSizes reads them. */
export interface SizeInputs {
  tree: { parent: string; child: string | null }[];
  entities: IdRow[];
  targets: IdRow[];
  partners: { acc: string; partners: string[] }[];
}

/** ResourceFactory.AUX: counted, but not importable. */
const AUXILIARY = new Set(['NCBI_PROTEIN', 'EMBL', 'COMPOUND', 'PUBCHEM_COMPOUND']);

/** A pathway's static counts for one resource, its subpathways' included. */
export interface ResourceCounts {
  /** Distinct identifiers its reactions reach. */
  entities: number;
  /** Distinct identifiers of their interaction partners. */
  interactors: number;
  /** Those two together (analysis-core's totalFound at build time). */
  entitiesAndInteractors: number;
  /** Its reactions that reach the resource, or reach an interactor of it. */
  reactions: number;
}

/**
 * A pathway's static figures as analysis-core's PathwayNodeData.setCounters
 * makes them: per resource, and over all resources (`combined`) or the main
 * ones alone (`importable`) -- identifiers summed over resources, reactions
 * as one set.
 */
export interface PathwayFigures {
  resources: Map<string, ResourceCounts>;
  combined: ResourceCounts;
  importable: ResourceCounts;
}

/** Every pathway's figures, and the species' -- the ratios' denominators. */
export interface AnalysisFigures {
  pathways: Map<string, PathwayFigures>;
  species: PathwayFigures;
}

type Sets = Map<string, { entities: Set<string>; partners: Set<string>; reactions: Set<string> }>;

const setsFor = (sets: Sets, resource: string) => {
  let found = sets.get(resource);
  if (!found)
    sets.set(
      resource,
      (found = { entities: new Set(), partners: new Set(), reactions: new Set() })
    );
  return found;
};

function figuresOf(sets: Sets): PathwayFigures {
  const resources = new Map<string, ResourceCounts>();
  const combined = { entities: 0, interactors: 0, entitiesAndInteractors: 0, reactions: 0 };
  const importable = { ...combined };
  const allReactions = new Set<string>();
  const importableReactions = new Set<string>();
  for (const [resource, { entities, partners, reactions }] of sets) {
    const together = new Set([...entities, ...partners]);
    const counts = {
      entities: entities.size,
      interactors: partners.size,
      entitiesAndInteractors: together.size,
      reactions: reactions.size,
    };
    resources.set(resource, counts);
    for (const total of AUXILIARY.has(resource) ? [combined] : [combined, importable]) {
      total.entities += counts.entities;
      total.interactors += counts.interactors;
      total.entitiesAndInteractors += counts.entitiesAndInteractors;
    }
    for (const reaction of reactions) {
      allReactions.add(reaction);
      if (!AUXILIARY.has(resource)) importableReactions.add(reaction);
    }
  }
  combined.reactions = allReactions.size;
  importable.reactions = importableReactions.size;
  return { resources, combined, importable };
}

/**
 * Every pathway's figures in the tree the inputs describe, by stable id, and
 * the species'. Entities and their reactions come from EntitiesBuilder's rows.
 * An interactor adds its identifier under each target's resource, and -- as
 * PathwayNode.processInteractor does -- the reactions of every target it
 * interacts with in the pathway under each of those targets' resources, so a
 * UniProt target's reactions can count for ChEBI (research D25).
 */
export function computeFigures({ tree, entities, targets, partners }: SizeInputs): AnalysisFigures {
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
  const own = new Map<string, Sets>();
  const ownOf = (pathway: string) => {
    let sets = own.get(pathway);
    if (!sets) own.set(pathway, (sets = new Map()));
    return sets;
  };
  for (const { pathway, ids } of entities) {
    const sets = ownOf(pathway);
    for (const [databaseName, id, reactions] of ids) {
      const resource = countedResource(databaseName);
      if (resource === undefined) continue;
      const of = setsFor(sets, resource);
      of.entities.add(id);
      for (const reaction of reactions) of.reactions.add(String(reaction));
    }
  }
  for (const { pathway, ids } of targets) {
    const sets = ownOf(pathway);
    // Per partner: the targets' resources it interacts with here, and their reactions.
    const byPartner = new Map<string, { resources: Set<string>; reactions: Set<string> }>();
    for (const [databaseName, id, reactions] of ids) {
      const resource = countedResource(databaseName);
      if (resource === undefined) continue;
      for (const partner of partnersOf.get(id) ?? []) {
        setsFor(sets, resource).partners.add(partner);
        let entry = byPartner.get(partner);
        if (!entry)
          byPartner.set(partner, (entry = { resources: new Set(), reactions: new Set() }));
        entry.resources.add(resource);
        for (const reaction of reactions) entry.reactions.add(String(reaction));
      }
    }
    for (const { resources, reactions } of byPartner.values())
      for (const resource of resources)
        for (const reaction of reactions) setsFor(sets, resource).reactions.add(reaction);
  }

  const done = new Map<string, Sets>();
  const total = (pathway: string): Sets => {
    const known = done.get(pathway);
    if (known) return known;
    const sets: Sets = new Map();
    const add = (from: Sets | undefined) => {
      for (const [resource, of] of from ?? []) {
        const into = setsFor(sets, resource);
        for (const id of of.entities) into.entities.add(id);
        for (const id of of.partners) into.partners.add(id);
        for (const id of of.reactions) into.reactions.add(id);
      }
    };
    add(own.get(pathway));
    for (const child of children.get(pathway) ?? []) add(total(child));
    done.set(pathway, sets);
    return sets;
  };
  const pathways = new Map<string, PathwayFigures>();
  const species: Sets = new Map();
  for (const pathway of children.keys()) {
    const sets = total(pathway);
    pathways.set(pathway, figuresOf(sets));
    for (const [resource, of] of sets) {
      const into = setsFor(species, resource);
      for (const id of of.entities) into.entities.add(id);
      for (const id of of.partners) into.partners.add(id);
      for (const id of of.reactions) into.reactions.add(id);
    }
  }
  return { pathways, species: figuresOf(species) };
}

/** Every pathway's size in the tree the inputs describe, by stable id. */
export function computeSizes(inputs: SizeInputs) {
  const sizes = new Map<string, AnalysisSize>();
  for (const [pathway, { combined }] of computeFigures(inputs).pathways)
    sizes.set(pathway, {
      totalEntity: combined.entities,
      totalEntityAndInteractors: combined.entitiesAndInteractors,
    });
  return sizes;
}

/** The graph's inputs for one species. */
async function sizeInputs(taxId: string): Promise<SizeInputs> {
  const tree = await read<SizeInputs['tree'][number]>(TREE_QUERY, { taxId });
  const pathways = [
    ...new Set(tree.flatMap(({ parent, child }) => (child === null ? [parent] : [parent, child]))),
  ];
  const [entities, targets] = await Promise.all([
    read<IdRow>(ENTITIES_QUERY, { pathways }),
    read<IdRow>(TARGETS_QUERY, { pathways }),
  ]);
  const accs = [...new Set(targets.flatMap((row) => row.ids.map(([, id]) => id)))];
  const partners = await read<SizeInputs['partners'][number]>(PARTNERS_QUERY, { accs });
  return { tree, entities, targets, partners };
}

const bySpecies = new Map<string, Promise<AnalysisFigures>>();

/**
 * Every pathway's figures for a species, by taxId, computed once while the
 * process lives; a failed computation is tried again on the next call.
 */
export function analysisFigures(taxId: string): Promise<AnalysisFigures> {
  let figures = bySpecies.get(taxId);
  if (!figures) {
    figures = sizeInputs(taxId).then(computeFigures);
    figures.catch(() => bySpecies.delete(taxId));
    bySpecies.set(taxId, figures);
  }
  return figures;
}

/** Every pathway's size for a species, by taxId (analysisFigures' totals). */
export async function analysisSizes(taxId: string): Promise<Map<string, AnalysisSize>> {
  const sizes = new Map<string, AnalysisSize>();
  for (const [pathway, { combined }] of (await analysisFigures(taxId)).pathways)
    sizes.set(pathway, {
      totalEntity: combined.entities,
      totalEntityAndInteractors: combined.entitiesAndInteractors,
    });
  return sizes;
}
