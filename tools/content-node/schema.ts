/**
 * graph-core's domain model, as much of it as /data/schema/{className}/count
 * and /min need -- the two questions Java answers by reflection:
 *
 *  - is `className` a class? `DatabaseObjectUtils.getClassForName` is
 *    `Class.forName("org.reactome.server.graph.domain.model." + className)`,
 *    and a ClassNotFoundException is the service's 500, "Specified class was
 *    not found". Any class in that package counts, not only the ones nodes are
 *    labelled with -- which is why this is a table and not the graph's labels.
 *  - does it have a species? `SchemaService.isValidSpeciesClass` is
 *    `clazz.getMethod("getSpecies")` succeeding.
 *
 * And one more the answer's rows depend on: which class a node's labels name
 * (DatabaseObjectUtils.getSchemaClass), which needs the class hierarchy.
 *
 * /schema/model, /attributes and /referrals need the rest of the reflection.
 * The hierarchy here builds the model's tree (schemaModelTree; the counts are
 * the graph's). A class's attributes and referrals -- its getters and their
 * types, and other classes' getters that return it -- are Java's own answers,
 * captured into schema-snapshot.json by snapshot-schema.ts, which checks that
 * they cover exactly the classes listed here.
 *
 * Derived from graph-core's source (src/main/java/org/reactome/server/graph/
 * domain/model, main at 62aef35d, the model's last change, 25 Sep 2025) and
 * checked, on 14 Oct 2026, by reflection over the graph-core-3.0.0-SNAPSHOT jar
 * the deployed ContentService runs: the same 113 classes, the same
 * assignability between them, and the same 27 classes with getSpecies.
 *
 * WHEN GRAPH-CORE'S MODEL CHANGES -- a class added, removed, re-parented, or a
 * getSpecies added or removed -- this file is wrong until it is updated, and
 * nothing will say so except the diff harness. To update:
 *
 *  1. SCHEMA_CLASSES: one entry per file in domain/model, naming its
 *     superclass (`extends`) and either of the model's own interfaces it
 *     implements (Trackable, Deletable). Interfaces from elsewhere --
 *     DatabaseObjectLike, CompositionAggregator, Serializable -- are left out:
 *     no label can name them, so they never decide anything here.
 *  2. DECLARES_SPECIES: every class with its own public `getSpecies()`
 *     (`grep -l 'getSpecies()' domain/model/*.java`). Subclasses inherit it,
 *     and isSpeciesClass follows the table, so only the declaring classes are
 *     listed.
 *  3. AJC_CLOSURES: regenerate from the jar the service runs, with
 *       unzip -l graph-core-*.jar | grep 'domain/model/[^/]*\$AjcClosure'
 *     They are AspectJ's, not graph-core's source: woven in at build time,
 *     renumbered whenever the woven code changes. Class.forName finds them,
 *     so Java counts them (0) rather than refusing them.
 *  4. The tests in schema.spec.ts pin the 113, the 27 and the hierarchy;
 *     update them from the new jar, then run the diff harness over every label.
 *  5. Regenerate schema-snapshot.json from the Java service running the new
 *     jar: `node tools/content-node/snapshot-schema.ts` (see its header). It
 *     holds /schema/{className}/attributes and /referrals, which are
 *     reflection too, and refuses to write if its classes are not these.
 */
import { readFileSync } from 'node:fs';

/**
 * Every class in graph-core's domain.model package, and the model classes it
 * directly extends or implements.
 */
export const SCHEMA_CLASSES = {
  AbstractModifiedResidue: ['DatabaseObject'],
  Affiliation: ['DatabaseObject'],
  Anatomy: ['ExternalOntology'],
  BlackBoxEvent: ['ReactionLikeEvent'],
  Book: ['Publication'],
  CandidateSet: ['EntitySet'],
  CatalystActivity: ['DatabaseObject'],
  CatalystActivityReference: ['ControlReference'],
  Cell: ['PhysicalEntity'],
  CellDevelopmentStep: ['ReactionLikeEvent'],
  CellLineagePath: ['Pathway'],
  CellType: ['ExternalOntology'],
  ChemicalDrug: ['Drug'],
  Compartment: ['GO_CellularComponent'],
  Complex: ['PhysicalEntity'],
  ControlReference: ['DatabaseObject'],
  ControlledVocabulary: ['DatabaseObject'],
  CrosslinkedResidue: ['TranslationalModification'],
  DBInfo: ['Release'],
  DatabaseIdentifier: ['DatabaseObject'],
  DatabaseObject: [],
  DefinedSet: ['EntitySet'],
  Deletable: [],
  Deleted: ['MetaDatabaseObject'],
  DeletedControlledVocabulary: ['ControlledVocabulary'],
  DeletedInstance: ['MetaDatabaseObject'],
  Depolymerisation: ['ReactionLikeEvent'],
  DirectedInteraction: ['Interaction'],
  Disease: ['ExternalOntology'],
  Drug: ['PhysicalEntity'],
  DrugActionType: ['ReactionType'],
  DrugType: ['DatabaseObject'],
  EntityFunctionalStatus: ['DatabaseObject'],
  EntitySet: ['PhysicalEntity'],
  EntityWithAccessionedSequence: ['GenomeEncodedEntity'],
  Event: ['DatabaseObject', 'Trackable', 'Deletable'],
  EvidenceType: ['ExternalOntology'],
  ExternalOntology: ['DatabaseObject'],
  FailedReaction: ['ReactionLikeEvent'],
  Figure: ['DatabaseObject'],
  FragmentDeletionModification: ['FragmentModification'],
  FragmentInsertionModification: ['FragmentModification'],
  FragmentModification: ['GeneticallyModifiedResidue'],
  FragmentReplacedModification: ['FragmentModification'],
  FunctionalStatus: ['DatabaseObject'],
  FunctionalStatusType: ['DatabaseObject'],
  GO_BiologicalProcess: ['GO_Term'],
  GO_CellularComponent: ['GO_Term'],
  GO_MolecularFunction: ['GO_Term'],
  GO_Term: ['DatabaseObject'],
  GeneticallyModifiedResidue: ['AbstractModifiedResidue'],
  GenomeEncodedEntity: ['PhysicalEntity'],
  GroupModifiedResidue: ['TranslationalModification'],
  InstanceEdit: ['DatabaseObject'],
  InterChainCrosslinkedResidue: ['CrosslinkedResidue'],
  Interaction: ['DatabaseObject'],
  InteractionEvent: ['Event'],
  IntraChainCrosslinkedResidue: ['CrosslinkedResidue'],
  LiteratureReference: ['Publication'],
  MarkerReference: ['ControlReference'],
  MetaDatabaseObject: ['DatabaseObject'],
  ModifiedNucleotide: ['TranscriptionalModification'],
  ModifiedResidue: ['TranslationalModification'],
  NegativeGeneExpressionRegulation: ['NegativeRegulation'],
  NegativePrecedingEvent: ['DatabaseObject'],
  NegativePrecedingEventReason: ['ControlledVocabulary'],
  NegativeRegulation: ['Regulation'],
  NonsenseMutation: ['ReplacedResidue'],
  Ontology: ['DatabaseObject'],
  OtherEntity: ['PhysicalEntity'],
  Pathway: ['Event'],
  Person: ['DatabaseObject'],
  PhysicalEntity: ['DatabaseObject', 'Trackable', 'Deletable'],
  Polymer: ['PhysicalEntity'],
  Polymerisation: ['ReactionLikeEvent'],
  PositiveGeneExpressionRegulation: ['PositiveRegulation'],
  PositiveRegulation: ['Regulation'],
  ProteinDrug: ['Drug'],
  PsiMod: ['ExternalOntology'],
  Publication: ['DatabaseObject'],
  RNADrug: ['Drug'],
  Reaction: ['ReactionLikeEvent'],
  ReactionLikeEvent: ['Event'],
  ReactionType: ['ControlledVocabulary'],
  ReferenceDNASequence: ['ReferenceSequence'],
  ReferenceDatabase: ['DatabaseObject'],
  ReferenceEntity: ['DatabaseObject'],
  ReferenceGeneProduct: ['ReferenceSequence'],
  ReferenceGroup: ['ReferenceEntity'],
  ReferenceIsoform: ['ReferenceGeneProduct'],
  ReferenceMolecule: ['ReferenceEntity'],
  ReferenceRNASequence: ['ReferenceSequence'],
  ReferenceSequence: ['ReferenceEntity'],
  ReferenceTherapeutic: ['ReferenceEntity'],
  Regulation: ['DatabaseObject', 'Deletable'],
  RegulationReference: ['ControlReference'],
  RegulationType: ['DatabaseObject'],
  Release: ['MetaDatabaseObject'],
  ReplacedResidue: ['GeneticallyModifiedResidue'],
  Requirement: ['PositiveRegulation'],
  ReviewStatus: ['ControlledVocabulary'],
  SequenceOntology: ['ExternalOntology'],
  SimpleEntity: ['PhysicalEntity'],
  Species: ['Taxon'],
  Summation: ['DatabaseObject'],
  Taxon: ['DatabaseObject'],
  TopLevelPathway: ['Pathway'],
  Trackable: [],
  TranscriptionalModification: ['AbstractModifiedResidue'],
  TranslationalModification: ['AbstractModifiedResidue'],
  URL: ['Publication'],
  UndirectedInteraction: ['Interaction'],
  UpdateTracker: ['MetaDatabaseObject'],
};

/**
 * The classes that declare a public getSpecies(). Event's covers every event;
 * PhysicalEntity has none of its own, so only these entity classes do. Cell
 * and DeletedInstance return Taxa, the rest Species -- the query is the same.
 */
const DECLARES_SPECIES = [
  'Cell',
  'Complex',
  'DeletedInstance',
  'EntitySet',
  'Event',
  'GenomeEncodedEntity',
  'Polymer',
  'ReferenceSequence',
  'SimpleEntity',
];

/** `<Class>$AjcClosure<n>`, from the deployed jar (see step 3 above). */
const AJC_CLOSURES = {
  CandidateSet: [5],
  CatalystActivity: [3, 9, 15],
  Cell: [3, 7, 13, 17],
  Complex: [5, 9, 13, 17, 21],
  ControlReference: [3],
  DatabaseIdentifier: [3],
  Deleted: [3],
  DeletedInstance: [3],
  DrugActionType: [3],
  EntityFunctionalStatus: [3],
  EntitySet: [5, 9, 13],
  EntityWithAccessionedSequence: [5],
  Event: [3, 7, 13, 17, 21, 29, 33, 37, 43, 47, 51, 55, 59, 63, 67, 71, 75, 79, 87, 91, 95, 99],
  ExternalOntology: [3],
  GO_CellularComponent: [3, 7, 11, 15],
  InstanceEdit: [3],
  InterChainCrosslinkedResidue: [3, 7],
  InteractionEvent: [3],
  MarkerReference: [5],
  NegativePrecedingEvent: [3],
  Pathway: [5, 9, 15],
  Person: [7, 11, 15],
  PhysicalEntity: [
    5, 11, 15, 19, 23, 27, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 75, 81, 87, 93, 99, 105, 109,
    113, 117,
  ],
  Polymer: [3, 9],
  Publication: [3],
  ReactionLikeEvent: [3, 9, 13, 19, 23, 27, 31, 35, 39, 45, 51],
  ReferenceEntity: [3, 9],
  ReferenceGeneProduct: [3, 7],
  ReferenceIsoform: [3],
  ReferenceRNASequence: [3],
  Regulation: [3, 11, 17, 21, 25, 29, 35, 39, 43, 47],
  ReplacedResidue: [3],
  Summation: [3],
  Taxon: [3],
  UndirectedInteraction: [3],
};

const CLASSES = new Set(Object.keys(SCHEMA_CLASSES));

/** Every woven `<Class>$AjcClosure<n>` Class.forName finds, by name. */
export const AJC_CLOSURE_NAMES = Object.entries(AJC_CLOSURES).flatMap(([owner, numbers]) =>
  numbers.map((number) => `${owner}$AjcClosure${number}`)
);
const CLOSURES = new Set(AJC_CLOSURE_NAMES);

/** The model's own interfaces: no superclass, so their own methods only. */
const INTERFACES = new Set(['Deletable', 'Trackable']);

/** Whether Java's Class.forName finds `name` in the model package. */
export function isSchemaClass(name) {
  return CLASSES.has(name) || CLOSURES.has(name);
}

/**
 * The model classes `name` is assignable to, itself included -- what
 * `Class.isAssignableFrom` says between two model classes. A closure extends
 * AspectJ's AroundClosure, so it is assignable to no model class but itself.
 */
export function supertypes(name) {
  const found = new Set();
  const visit = (current) => {
    if (found.has(current)) return;
    found.add(current);
    for (const parent of CLASSES.has(current) ? SCHEMA_CLASSES[current] : []) visit(parent);
  };
  if (isSchemaClass(name)) visit(name);
  return found;
}

/** SchemaService.isValidSpeciesClass: getSpecies() declared or inherited. */
export function isSpeciesClass(name) {
  return CLASSES.has(name) && DECLARES_SPECIES.some((owner) => supertypes(name).has(owner));
}

/**
 * DatabaseObjectUtils.getSchemaClass: the labels in the order the graph gives
 * them, each that is a class replacing the answer when the answer so far is
 * assignable from it, starting from Object. Usually the most specific class;
 * the rule is kept rather than that summary, because the two part when an
 * interface label comes first.
 */
export function schemaClassOf(labels) {
  let lowest = 'Object';
  for (const label of labels ?? []) {
    if (!isSchemaClass(label)) continue;
    if (lowest === 'Object' || supertypes(label).has(lowest)) lowest = label;
  }
  return lowest;
}

/**
 * Class.getSuperclass, within the model: the class `name` extends, listed
 * first in its entry. Undefined above DatabaseObject (Object), for an
 * interface, and for anything that is not a model class.
 */
export function superclassOf(name) {
  if (!CLASSES.has(name) || INTERFACES.has(name)) return undefined;
  return SCHEMA_CLASSES[name][0];
}

/** One row of an attribute or referrals table, as Java's answer writes it. */
export interface AttributeRow {
  name: string;
  cardinality: string;
  valueTypes: { name: string; databaseObject: boolean }[];
  origin: string;
}
/** Java's /schema/model: a class, its count, its subclasses. */
interface SchemaModelNode {
  className: string;
  count: number;
  children?: SchemaModelNode[];
}
/** What the tables are composed from (snapshot-schema.ts checks them before writing). */
export interface SchemaTables {
  declared: Record<string, AttributeRow[]>;
  referralRows: AttributeRow[];
  referrals: Record<string, number[]>;
  closure: { attributes: AttributeRow[]; referrals: AttributeRow[] };
}
export interface SchemaSnapshot extends SchemaTables {
  release: number;
  model: SchemaModelNode;
}

let snapshot: SchemaSnapshot | undefined;
/**
 * schema-snapshot.json, read once: Java's /schema/{className}/attributes and
 * /referrals, captured by snapshot-schema.ts, in the shape below.
 *
 *  - declared: per class, the rows of its attribute table whose origin is the
 *    class itself -- the getters it declares. A class's table is its own rows
 *    and every superclass's (attributeTable), so each is stored once.
 *  - referralRows and referrals: every distinct row of a referrals answer,
 *    once, and per class the indexes of its rows in Java's order.
 *  - closure: the one answer of both for every woven $AjcClosure class.
 *  - model: Java's /schema/model when captured, for schema.spec.ts only.
 */
export function schemaSnapshot() {
  snapshot ??= JSON.parse(
    readFileSync(new URL('./schema-snapshot.json', import.meta.url), 'utf8')
  ) as SchemaSnapshot;
  return snapshot;
}

/** Java's String.compareTo: UTF-16 code units, which is what `<` compares. */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * DatabaseObjectUtils.getAttributeTable, as the controller writes it: the
 * getters `name` and each superclass declare, in a TreeSet ordered by name
 * then by the declaring class's name. Undefined where Class.forName fails.
 */
export function attributeTable(name: string, data: SchemaTables = schemaSnapshot()) {
  if (CLOSURES.has(name)) return data.closure.attributes;
  if (!CLASSES.has(name)) return undefined;
  const rows: { name: string; origin: string }[] = [];
  for (let at: string | undefined = name; at !== undefined; at = superclassOf(at)) {
    const own = data.declared[at];
    if (!own) throw new Error(`schema-snapshot.json has no attributes for ${at}`);
    rows.push(...own);
  }
  return rows.sort((a, b) => byCodeUnits(a.name, b.name) || byCodeUnits(a.origin, b.origin));
}

/**
 * DatabaseObjectUtils.getReferrals, as the controller writes it: the getters
 * of other classes whose type is `name` or one of its superclasses. Undefined
 * where Class.forName fails.
 */
export function referralsTable(name: string, data: SchemaTables = schemaSnapshot()) {
  if (CLOSURES.has(name)) return data.closure.referrals;
  if (!CLASSES.has(name)) return undefined;
  const indexes = data.referrals[name];
  if (!indexes) throw new Error(`schema-snapshot.json has no referrals for ${name}`);
  return indexes.map((index) => data.referralRows[index]);
}

/**
 * DatabaseObjectUtils.getGraphModelTree, from SchemaRepository's rows -- each
 * a distinct set of labels and how many nodes carry it. Each row's class is
 * the one its labels name (schemaClassOf); its count goes to that class, and
 * the class and its superclasses are linked into the tree, children ordered
 * by class name (SchemaNode's TreeSet). Each count then becomes the sum of its
 * subtree's. Jackson leaves an empty children set out.
 *
 * A label that is not a model class is where Java's Class.forName throws; the
 * controller swallows it and answers an empty 200, uncached. Here it throws:
 * the graph has a class this table does not, so schema.ts is out of date,
 * and an empty answer would hide that.
 */
export function schemaModelTree(rows) {
  const nodes = new Map();
  const link = (name, below, count) => {
    if (name === undefined) return; // Object
    const existing = nodes.get(name);
    if (existing) {
      if (below) existing.children.push(below);
      else existing.count += count;
      return;
    }
    const node = { className: name, count, children: below ? [below] : [] };
    nodes.set(name, node);
    if (INTERFACES.has(name)) {
      // Java's recursion reaches getSuperclass() == null and fails there.
      throw new Error(`schema model: rows whose most specific label is the interface ${name}`);
    }
    link(superclassOf(name), node, 0);
  };
  for (const row of rows) {
    const unknown = row.labels.find((label) => !isSchemaClass(label));
    if (unknown !== undefined) {
      throw new Error(`schema model: label ${unknown} is not a class in schema.ts`);
    }
    const lowest = schemaClassOf(row.labels);
    link(lowest === 'Object' ? undefined : lowest, undefined, row.count);
  }
  const shape = (node) => {
    const children = node.children.sort((a, b) => byCodeUnits(a.className, b.className)).map(shape);
    const count = children.reduce((sum, child) => (sum + child.count) | 0, node.count);
    return children.length
      ? { className: node.className, count, children }
      : { className: node.className, count };
  };
  const root = nodes.get('DatabaseObject');
  return root === undefined ? undefined : shape(root);
}
