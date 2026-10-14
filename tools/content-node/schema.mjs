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
 *  4. The tests in schema.spec.mjs pin the 113, the 27 and the hierarchy;
 *     update them from the new jar, then run the diff harness over every label.
 */

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
const CLOSURES = new Set(
  Object.entries(AJC_CLOSURES).flatMap(([owner, numbers]) =>
    numbers.map((number) => `${owner}$AjcClosure${number}`)
  )
);

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
