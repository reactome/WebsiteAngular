/**
 * Step 1 of the reaction layout (research D22): from the graph to the glyphs
 * and compartments, as reaction-exporter's LayoutFactory and Layout build
 * them and BoxAlgorithm's constructor prepares them -- before anything is
 * sized or placed.
 *
 * Java reads the reaction and its participants lazily, getter by getter;
 * the same fields are read here explicitly. A list it loads lazily comes in
 * its relationships' `order` (AdvancedDatabaseObjectRepository's
 * relationship query), and a single value is there only when exactly one
 * relationship leads to it.
 */
import { JavaHashMap } from '../java-hashmap.ts';
import { read } from '../graph.ts';
import { LAYOUT_QUERY } from './layout-query.ts';
import { masterTree, readCellularComponents, treeWithIntermediateNodes } from './go-tree.ts';
import type { GoTerm } from './go-tree.ts';
import {
  AttachmentGlyph,
  CompartmentGlyph,
  EntityGlyph,
  GlyphIds,
  GlyphSet,
  JavaNullPointerException,
  JavaRuntimeException,
  ReactionGlyph,
} from './model.ts';
import type { CompartmentData, EntityData, EntityRole, ReactionData } from './model.ts';

const EXTRACELLULAR_REGION_ACCESSION = '0005576';

/** A layout's glyphs and compartments, ready to be sized and placed. */
export interface Inputs {
  /** The diagram's stable id: the pathway with a diagram, as the driver reads it. */
  pathway: string;
  reaction: ReactionGlyph;
  entities: GlyphSet<EntityGlyph>;
  /** Layout.compartments: by bare accession. */
  compartments: JavaHashMap<string, CompartmentGlyph>;
  root: CompartmentGlyph;
  ids: GlyphIds;
}

/** One row of the layout query's participants, as LayoutParticipants.build reads it. */
interface Participant {
  physicalEntity: string | null;
  role: { n: number | null; type: string | null };
  drug: boolean | null;
  dashed: boolean | null;
  crossed: boolean | null;
}

let master: Promise<JavaHashMap<string, GoTerm>> | undefined;

/**
 * The master tree, read once: Java's is static, and the graph does not change
 * within a release. A service left running across a move to the next
 * release's graph keeps the old tree until it restarts, as Java does.
 */
function masterOnce() {
  master ??= readCellularComponents().then(masterTree);
  // A failed read is not kept: the next request reads again.
  master.catch(() => (master = undefined));
  return master;
}

/**
 * The inputs of `stId`'s layout, with glyph ids from `first` (D22: the
 * service starts at 1, the comparison where Java's answer started).
 */
export async function readInputs(stId: string, first = 1): Promise<Inputs> {
  const ids = new GlyphIds(first);
  const [result] = await read<{
    pathway: string | null;
    reactionLikeEvent: string;
    participants: Participant[];
  }>(LAYOUT_QUERY, { stId });
  // getCustomQueryResult with no row is null, and reading it Java's NullPointerException.
  if (!result) throw new JavaNullPointerException();

  // Layout.setReactionLikeEvent: the reaction glyph first, then its first compartment.
  const compartments = new JavaHashMap<string, CompartmentGlyph>();
  const reactionData = await readReaction(result.reactionLikeEvent);
  const reaction = new ReactionGlyph(ids, reactionData);
  const [reactionCompartment] = reactionData.compartments;
  if (reactionCompartment) {
    const glyph = compartmentFor(compartments, ids, reactionCompartment);
    glyph.contained.add(reaction);
    reaction.compartment = glyph;
  }

  // LayoutFactory: a glyph per participant row, in the query's order.
  const rows = result.participants;
  const data = await readEntities(rows.map((row) => row.physicalEntity));
  const participants = rows.map((row, at) => {
    const entity = new EntityGlyph(ids);
    entity.drug = row.drug ?? false;
    entity.dashed = row.dashed ?? false;
    setPhysicalEntity(entity, ids, data[at]);
    entity.roles.push({ type: roleType(row.role.type), n: row.role.n ?? 1 });
    return entity;
  });

  // Layout.setParticipants: one glyph per identifier, roles merged into the first.
  const byIdentifier = new JavaHashMap<string, EntityGlyph>();
  for (const participant of participants) {
    const found = byIdentifier.get(participant.identifier);
    if (found) found.roles.push(participant.roles[0] as EntityGlyph['roles'][number]);
    else byIdentifier.set(participant.identifier, participant);
  }
  const merged = [...byIdentifier.values()];
  for (const entity of merged) {
    const [first] = entity.compartments;
    if (!first) continue;
    const glyph = compartmentFor(compartments, ids, first);
    glyph.contained.add(entity);
    entity.compartment = glyph;
  }
  const entities = GlyphSet.of(merged);

  // createCompartmentsStructure: the GO tree joining the compartments, as glyphs.
  const goIds = [...compartments.values()].map((glyph) => `GO:${glyph.accession}`);
  const treeRoot = treeWithIntermediateNodes(await masterOnce(), goIds);
  const root = compartmentForTerm(compartments, ids, treeRoot);
  buildHierarchy(compartments, ids, root, treeRoot);

  const inputs: Inputs = {
    // LayoutResult reads the pathway with Value.asString(): a missing one is the string "null".
    pathway: result.pathway ?? 'null',
    reaction,
    entities,
    compartments,
    root,
    ids,
  };
  prepare(inputs);
  return inputs;
}

/** compartments.computeIfAbsent(accession, new CompartmentGlyph(compartment)). */
function compartmentFor(
  compartments: JavaHashMap<string, CompartmentGlyph>,
  ids: GlyphIds,
  data: CompartmentData
): CompartmentGlyph {
  return compartments.computeIfAbsent(data.accession, () => new CompartmentGlyph(ids, data));
}

/** The same for a term of the GO tree: a glyph with its name and accession only. */
function compartmentForTerm(
  compartments: JavaHashMap<string, CompartmentGlyph>,
  ids: GlyphIds,
  term: GoTerm
): CompartmentGlyph {
  return compartments.computeIfAbsent(
    term.accession,
    () => new CompartmentGlyph(ids, { name: term.name, accession: term.accession })
  );
}

/** buildCompartmentHierarchy: each term inside `term`, as a child glyph, depth first. */
function buildHierarchy(
  compartments: JavaHashMap<string, CompartmentGlyph>,
  ids: GlyphIds,
  glyph: CompartmentGlyph,
  term: GoTerm
) {
  for (const inner of term.incomingTerms()) {
    const child = compartmentForTerm(compartments, ids, inner);
    glyph.children.add(child);
    child.setParent(glyph);
    buildHierarchy(compartments, ids, child, inner);
  }
}

/**
 * BoxAlgorithm's constructor, before the layout index: DuplicateManager's
 * copies, then the fixes for a reaction or entity with no compartment.
 */
export function prepare({ reaction, entities, root, ids }: Inputs) {
  // DuplicateManager.addDuplicates: for each role but the first that is not
  // an input or a catalyst, a copy of the entity holding that role alone.
  const added: EntityGlyph[] = [];
  for (const entity of entities) {
    if (entity.roles.length <= 1) continue;
    for (const role of [...entity.roles]) {
      if (role.type === 'input' || role.type === 'catalyst' || entity.roles.length === 1) continue;
      const copy = new EntityGlyph(ids, entity);
      copy.roles.push(role);
      entity.roles.splice(entity.roles.indexOf(role), 1);
      copy.compartment = entity.compartment;
      if (!entity.compartment) throw new JavaNullPointerException();
      entity.compartment.contained.add(copy);
      added.push(copy);
    }
  }
  for (const copy of added) entities.add(copy);

  // fixReactionWithNoCompartment and fixEntityWithNoCompartment.
  if (!reaction.compartment) {
    reaction.compartment = root;
    root.contained.add(reaction);
  }
  for (const entity of entities)
    if (!entity.compartment) {
      entity.compartment = root;
      root.contained.add(entity);
    }
}

/** removeExtracellular: the root leaves the compartments when it is the extracellular region. */
export function removeExtracellular({ compartments, root }: Inputs) {
  if (root.accession === EXTRACELLULAR_REGION_ACCESSION) compartments.delete(root.accession);
}

/** EntityRole.get: the type in lower case; an unknown one is null, which nothing here handles. */
function roleType(type: string | null): EntityRole {
  if (type === null) throw new JavaNullPointerException();
  const lower = type.toLowerCase();
  if (['input', 'output', 'catalyst', 'negative', 'positive'].includes(lower))
    return lower as EntityRole;
  throw new JavaNullPointerException();
}

/** EntityGlyph.setPhysicalEntity: the entity's fields, attachments and renderable class. */
function setPhysicalEntity(entity: EntityGlyph, ids: GlyphIds, data: EntityData | undefined) {
  if (!data) throw new JavaNullPointerException();
  entity.dbId = data.dbId;
  entity.stId = data.stId;
  // getName().get(0): a null list is a NullPointerException, an empty one IndexOutOfBounds.
  if (data.names === null) throw new JavaNullPointerException();
  if (!data.names.length) throw new JavaRuntimeException('Index 0 out of bounds for length 0');
  entity.name = data.names[0] as string;
  entity.inDisease = data.inDisease;
  entity.compartments = data.compartments;
  entity.schemaClass = data.schemaClass;
  if (data.referenceLabels?.includes('ReferenceMolecule') && data.referenceTrivial === true)
    entity.trivial = true;
  for (const residue of data.modifiedResidues)
    if (residue.labels.includes('TranslationalModification'))
      entity.attachments.push(new AttachmentGlyph(ids, residue));
  entity.renderableClass = renderableClass(data, entity.drug);
}

/** RenderableClass.getRenderableClass for a physical entity, by its labels (instanceof). */
function renderableClass(data: EntityData & { displayName?: string }, drug: boolean): string {
  const is = (label: string) => data.labels.includes(label);
  if (is('EntitySet')) return drug ? 'EntitySetDrug' : 'EntitySet';
  if (is('Complex')) return drug ? 'ComplexDrug' : 'Complex';
  if (is('SimpleEntity')) return 'Chemical';
  if (is('ChemicalDrug')) return 'ChemicalDrug';
  if (is('ProteinDrug')) return 'ProteinDrug';
  if (is('RNADrug')) return 'RNADrug';
  if (is('Cell')) return 'Cell';
  if (is('EntityWithAccessionedSequence')) {
    const reference = data.referenceLabels ?? [];
    if (reference.includes('ReferenceGeneProduct')) return 'Protein';
    if (reference.includes('ReferenceDNASequence')) return 'Gene';
    if (reference.includes('ReferenceRNASequence')) return 'RNA';
  }
  if (is('GenomeEncodedEntity') || is('OtherEntity') || is('Polymer')) return 'Entity';
  throw new JavaRuntimeException(`No Schema class defined for [${data.dbId}:${data.displayName}]`);
}

/** RenderableClass.getFromCategory: the reaction's category by name, Transition otherwise. */
const RENDERABLE_NAMES = [
  'Attachement',
  'Cell',
  'Chemical',
  'ChemicalDrug',
  'Compartment',
  'Complex',
  'ComplexDrug',
  'EncapsulatedNode',
  'Entity',
  'EntitySet',
  'EntitySetDrug',
  'Gene',
  'Protein',
  'ProteinDrug',
  'RNA',
  'RNADrug',
  'ProcessNode',
  'Binding',
  'Dissociation',
  'Omitted',
  'Transition',
  'Uncertain',
];
export function reactionRenderableClass(category: string | null): string {
  if (category === null || category.trim() === '') return 'Transition';
  return (
    RENDERABLE_NAMES.find((name) => name.toLowerCase() === category.toLowerCase()) ?? 'Transition'
  );
}

/** A list's relationships by `order`, each object repeated by its stoichiometry. */
const COMPARTMENTS = (node: string) => `
  CALL { WITH ${node}
    OPTIONAL MATCH (${node})-[c:compartment]->(m:Compartment)
    WITH c, m ORDER BY c.order
    RETURN [x IN collect(CASE WHEN m IS NULL THEN null ELSE
      {dbId: m.dbId, schemaClass: m.schemaClass, displayName: m.displayName, accession: m.accession,
       n: coalesce(c.stoichiometry, 1)} END) | x] AS compartments }`;

/** Each compartment repeated by its stoichiometry, as findCollectionByRelationship lists it. */
function repeated<T extends { n: number }>(list: T[]): Omit<T, 'n'>[] {
  return list.flatMap(({ n, ...rest }) => Array.from({ length: n }, () => rest));
}

async function readReaction(stId: string): Promise<ReactionData> {
  const [row] = await read<
    Omit<ReactionData, 'compartments'> & { compartments: (CompartmentData & { n: number })[] }
  >(
    `MATCH (r:DatabaseObject {stId: $stId})
     ${COMPARTMENTS('r')}
     RETURN r.dbId AS dbId, r.stId AS stId, r.schemaClass AS schemaClass, r.displayName AS displayName,
            r.isInDisease AS isInDisease, r.category AS category, r.speciesName AS speciesName, compartments`,
    { stId }
  );
  if (!row) throw new JavaNullPointerException();
  return { ...row, compartments: repeated(row.compartments) };
}

/** Each participant row's entity, in the rows' order; undefined where there is none. */
async function readEntities(stIds: (string | null)[]): Promise<(EntityData | undefined)[]> {
  if (!stIds.length) return [];
  const rows = await read<
    Omit<EntityData, 'compartments' | 'modifiedResidues'> & {
      at: number;
      displayName: string;
      compartments: (CompartmentData & { n: number })[];
      modifiedResidues: (EntityData['modifiedResidues'][number] & { n: number })[];
    }
  >(
    `UNWIND range(0, size($stIds) - 1) AS at
     MATCH (pe:DatabaseObject {stId: $stIds[at]})
     ${COMPARTMENTS('pe')}
     CALL { WITH pe
       OPTIONAL MATCH (pe)-[:referenceEntity]->(re:ReferenceEntity)
       RETURN collect(re) AS references }
     CALL { WITH pe
       OPTIONAL MATCH (pe)-[h:hasModifiedResidue]->(mr:AbstractModifiedResidue)
       WITH h, mr ORDER BY h.order
       RETURN [x IN collect(CASE WHEN mr IS NULL THEN null ELSE
         {dbId: mr.dbId, schemaClass: mr.schemaClass, label: mr.label, labels: labels(mr),
          n: coalesce(h.stoichiometry, 1)} END) | x] AS modifiedResidues }
     RETURN at, pe.dbId AS dbId, pe.stId AS stId, pe.name AS names, pe.isInDisease AS inDisease,
            pe.schemaClass AS schemaClass, pe.displayName AS displayName, labels(pe) AS labels,
            compartments,
            CASE WHEN size(references) = 1 THEN labels(references[0]) END AS referenceLabels,
            CASE WHEN size(references) = 1 THEN references[0].trivial END AS referenceTrivial,
            modifiedResidues`,
    { stIds }
  );
  const byIndex = new Map(rows.map((row) => [row.at, row]));
  return stIds.map((_, at) => {
    const row = byIndex.get(at);
    if (!row) return undefined;
    const { at: _at, compartments, modifiedResidues, ...rest } = row;
    return {
      ...rest,
      compartments: repeated(compartments),
      modifiedResidues: repeated(modifiedResidues),
    };
  });
}
