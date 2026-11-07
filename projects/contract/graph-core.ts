// The rest of the graph's objects as the content service writes them (spec 016,
// T025d; research R9): the events, the physical and reference entities, the
// catalyst activities and regulations, interactions, the composition and
// relationship entries, and the deleted-object and release classes. From
// Pathway these 65 classes reach one another, so they are described at once;
// with the 23 of graph.ts they are every class the enhanced query can answer.
//
// Drafted from the domain snapshot (each property's Java type and target class)
// and the recorded answers (which properties every recorded object of a class
// carries); held by graph.spec.ts (fields and unions, both ways, against the
// snapshot) and by the schema check (every recorded enhanced answer).
//
// A field is required when every recorded object of its class has it. A class
// never recorded has its identity and class required and every other field
// optional, as the snapshot writes it. Under the service's non_empty, an empty
// list or text is left out, which is why most lists are optional.

import type {
  Affiliation,
  Anatomy,
  AnyGO_CellularComponent,
  AnyTaxon,
  Book,
  CellType,
  Compartment,
  DatabaseIdentifier,
  Disease,
  EvidenceType,
  Figure,
  GO_BiologicalProcess,
  GO_CellularComponent,
  GO_MolecularFunction,
  InstanceEdit,
  JsogFields,
  LiteratureReference,
  Person,
  PsiMod,
  Publication,
  Ref,
  ReferenceDatabase,
  ReviewStatus,
  SequenceOntology,
  Species,
  Summation,
  Taxon,
  UrlPublication,
} from './graph.ts';

/**
 * Any object of the graph, as the enhanced query answers it: one of its classes,
 * told apart by `schemaClass`. Java calls it DatabaseObject; the pathway
 * browser's resolved model keeps that name. @discriminator schemaClass
 */
export type GraphObject<R extends Ref> =
  | Affiliation<R>
  | Anatomy<R>
  | BlackBoxEvent<R>
  | Book<R>
  | CandidateSet<R>
  | CatalystActivity<R>
  | CatalystActivityReference<R>
  | Cell<R>
  | CellDevelopmentStep<R>
  | CellLineagePath<R>
  | CellType<R>
  | ChemicalDrug<R>
  | Compartment<R>
  | Complex<R>
  | DBInfo<R>
  | DatabaseIdentifier<R>
  | DefinedSet<R>
  | Deleted<R>
  | DeletedControlledVocabulary<R>
  | DeletedInstance<R>
  | Depolymerisation<R>
  | DirectedInteraction<R>
  | Disease<R>
  | DrugActionType<R>
  | DrugType<R>
  | EntityFunctionalStatus<R>
  | EntityWithAccessionedSequence<R>
  | EvidenceType<R>
  | FailedReaction<R>
  | Figure<R>
  | FragmentDeletionModification<R>
  | FragmentInsertionModification<R>
  | FragmentReplacedModification<R>
  | FunctionalStatus<R>
  | FunctionalStatusType<R>
  | GO_BiologicalProcess<R>
  | GO_CellularComponent<R>
  | GO_MolecularFunction<R>
  | GenomeEncodedEntity<R>
  | GroupModifiedResidue<R>
  | InstanceEdit<R>
  | InterChainCrosslinkedResidue<R>
  | InteractionEvent<R>
  | IntraChainCrosslinkedResidue<R>
  | LiteratureReference<R>
  | MarkerReference<R>
  | ModifiedNucleotide<R>
  | ModifiedResidue<R>
  | NegativeGeneExpressionRegulation<R>
  | NegativePrecedingEvent<R>
  | NegativePrecedingEventReason<R>
  | NegativeRegulation<R>
  | NonsenseMutation<R>
  | Ontology<R>
  | OtherEntity<R>
  | Pathway<R>
  | Person<R>
  | Polymer<R>
  | Polymerisation<R>
  | PositiveGeneExpressionRegulation<R>
  | PositiveRegulation<R>
  | ProteinDrug<R>
  | PsiMod<R>
  | RNADrug<R>
  | Reaction<R>
  | ReferenceDNASequence<R>
  | ReferenceDatabase<R>
  | ReferenceGeneProduct<R>
  | ReferenceGroup<R>
  | ReferenceIsoform<R>
  | ReferenceMolecule<R>
  | ReferenceRNASequence<R>
  | ReferenceTherapeutic<R>
  | RegulationReference<R>
  | RegulationType<R>
  | Release<R>
  | ReplacedResidue<R>
  | Requirement<R>
  | ReviewStatus<R>
  | SequenceOntology<R>
  | SimpleEntity<R>
  | Species<R>
  | SummaryEntity<R>
  | Summation<R>
  | Taxon<R>
  | TopLevelPathway<R>
  | UrlPublication<R>
  | UndirectedInteraction<R>
  | UpdateTracker<R>;

/** Any AbstractModifiedResidue. @discriminator schemaClass */
export type AbstractModifiedResidue<R extends Ref> =
  | FragmentDeletionModification<R>
  | FragmentInsertionModification<R>
  | FragmentReplacedModification<R>
  | GroupModifiedResidue<R>
  | InterChainCrosslinkedResidue<R>
  | IntraChainCrosslinkedResidue<R>
  | ModifiedNucleotide<R>
  | ModifiedResidue<R>
  | NonsenseMutation<R>
  | ReplacedResidue<R>;

/** The class and its subclasses. @discriminator schemaClass */
export type AnyNegativeRegulation<R extends Ref> =
  NegativeGeneExpressionRegulation<R> | NegativeRegulation<R>;

/** The class and its subclasses. @discriminator schemaClass */
export type AnyPathway<R extends Ref> = CellLineagePath<R> | Pathway<R> | TopLevelPathway<R>;

/** The class and its subclasses. @discriminator schemaClass */
export type AnyPositiveRegulation<R extends Ref> =
  PositiveGeneExpressionRegulation<R> | PositiveRegulation<R> | Requirement<R>;

/** The class and its subclasses. @discriminator schemaClass */
export type AnyReferenceGeneProduct<R extends Ref> = ReferenceGeneProduct<R> | ReferenceIsoform<R>;

/** The class and its subclasses. @discriminator schemaClass */
export type AnyRelease<R extends Ref> = DBInfo<R> | Release<R>;

/** Any Deletable. @discriminator schemaClass */
export type Deletable<R extends Ref> =
  | BlackBoxEvent<R>
  | CandidateSet<R>
  | Cell<R>
  | CellDevelopmentStep<R>
  | CellLineagePath<R>
  | ChemicalDrug<R>
  | Complex<R>
  | DefinedSet<R>
  | Depolymerisation<R>
  | EntityWithAccessionedSequence<R>
  | FailedReaction<R>
  | GenomeEncodedEntity<R>
  | InteractionEvent<R>
  | NegativeGeneExpressionRegulation<R>
  | NegativeRegulation<R>
  | OtherEntity<R>
  | Pathway<R>
  | Polymer<R>
  | Polymerisation<R>
  | PositiveGeneExpressionRegulation<R>
  | PositiveRegulation<R>
  | ProteinDrug<R>
  | RNADrug<R>
  | Reaction<R>
  | Requirement<R>
  | SimpleEntity<R>
  | TopLevelPathway<R>;

/** Any EntitySet. @discriminator schemaClass */
export type EntitySet<R extends Ref> = CandidateSet<R> | DefinedSet<R>;

/** Any Event. @discriminator schemaClass */
export type Event<R extends Ref> =
  | BlackBoxEvent<R>
  | CellDevelopmentStep<R>
  | CellLineagePath<R>
  | Depolymerisation<R>
  | FailedReaction<R>
  | InteractionEvent<R>
  | Pathway<R>
  | Polymerisation<R>
  | Reaction<R>
  | TopLevelPathway<R>;

/** Any PhysicalEntity. @discriminator schemaClass */
export type PhysicalEntity<R extends Ref> =
  | CandidateSet<R>
  | Cell<R>
  | ChemicalDrug<R>
  | Complex<R>
  | DefinedSet<R>
  | EntityWithAccessionedSequence<R>
  | GenomeEncodedEntity<R>
  | OtherEntity<R>
  | Polymer<R>
  | ProteinDrug<R>
  | RNADrug<R>
  | SimpleEntity<R>;

/** Any ReactionLikeEvent. @discriminator schemaClass */
export type ReactionLikeEvent<R extends Ref> =
  | BlackBoxEvent<R>
  | CellDevelopmentStep<R>
  | Depolymerisation<R>
  | FailedReaction<R>
  | Polymerisation<R>
  | Reaction<R>;

/** Any ReactionType. One class today; a union to the generator only once it has two. */
export type ReactionType<R extends Ref> = DrugActionType<R>;

/** Any ReferenceEntity. @discriminator schemaClass */
export type ReferenceEntity<R extends Ref> =
  | ReferenceDNASequence<R>
  | ReferenceGeneProduct<R>
  | ReferenceGroup<R>
  | ReferenceIsoform<R>
  | ReferenceMolecule<R>
  | ReferenceRNASequence<R>
  | ReferenceTherapeutic<R>;

/** Any ReferenceSequence. @discriminator schemaClass */
export type ReferenceSequence<R extends Ref> =
  ReferenceDNASequence<R> | ReferenceGeneProduct<R> | ReferenceIsoform<R> | ReferenceRNASequence<R>;

/** Any Regulation. @discriminator schemaClass */
export type Regulation<R extends Ref> =
  | NegativeGeneExpressionRegulation<R>
  | NegativeRegulation<R>
  | PositiveGeneExpressionRegulation<R>
  | PositiveRegulation<R>
  | Requirement<R>;

/** Any Trackable. @discriminator schemaClass */
export type Trackable<R extends Ref> =
  | BlackBoxEvent<R>
  | CandidateSet<R>
  | Cell<R>
  | CellDevelopmentStep<R>
  | CellLineagePath<R>
  | ChemicalDrug<R>
  | Complex<R>
  | DefinedSet<R>
  | Depolymerisation<R>
  | EntityWithAccessionedSequence<R>
  | FailedReaction<R>
  | GenomeEncodedEntity<R>
  | InteractionEvent<R>
  | OtherEntity<R>
  | Pathway<R>
  | Polymer<R>
  | Polymerisation<R>
  | ProteinDrug<R>
  | RNADrug<R>
  | Reaction<R>
  | SimpleEntity<R>
  | TopLevelPathway<R>;

/** Recorded 877 times. */
export interface BlackBoxEvent<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name?: string[];
  releaseDate?: string;
  releaseStatus?: string;
  speciesName: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric?: boolean;
  systematicName?: string;
  category?: string;
  catalystActivity?: (CatalystActivity<R> | R)[];
  catalystActivityReference?: CatalystActivityReference<R> | R;
  entityFunctionalStatus?: (EntityFunctionalStatus<R> | R)[];
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  input?: (PhysicalEntity<R> | R)[];
  output?: (PhysicalEntity<R> | R)[];
  normalReaction?: ReactionLikeEvent<R> | R;
  diseaseReactions?: DiseaseReaction<R>[];
  regulatedBy?: (Regulation<R> | R)[];
  regulationReference?: (RegulationReference<R> | R)[];
  requiredInputComponent?: (PhysicalEntity<R> | R)[];
  hasInteraction?: (InteractionEvent<R> | R)[];
  reactionType?: (ReactionType<R> | R)[];
  templateEvent?: Event<R> | R;
  className?: string;
  inputs?: Input<R>[];
  outputs?: Output<R>[];
  diseaseReaction?: (ReactionLikeEvent<R> | R)[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'BlackBoxEvent';
}

/** Recorded 71 times. */
export interface CandidateSet<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth: number;
  name: string[];
  speciesName: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isOrdered?: boolean;
  hasMember?: (PhysicalEntity<R> | R)[];
  species: (Species<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  hasCandidate?: (PhysicalEntity<R> | R)[];
  candidates?: HasCandidate<R>[];
  composedOf?: Default<R>[];
  members?: HasMember<R>[];
  className: string;
  hasCompartment?: HasCompartment<R>[];
  inDisease: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'CandidateSet';
}

/** Recorded 1,534 times. */
export interface CatalystActivity<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  activeUnit?: (PhysicalEntity<R> | R)[];
  activity?: GO_MolecularFunction<R> | R;
  catalyzedEvent?: (ReactionLikeEvent<R> | R)[];
  physicalEntity?: PhysicalEntity<R> | R;
  literatureReference?: (Publication<R> | R)[];
  className: string;
  schemaClass: 'CatalystActivity';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface CatalystActivityReference<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  literatureReference?: (Publication<R> | R)[];
  catalystActivity?: CatalystActivity<R> | R;
  className: string;
  schemaClass: 'CatalystActivityReference';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface Cell<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  markerReference?: (MarkerReference<R> | R)[];
  organ?: Anatomy<R> | R;
  proteinMarker?: (EntityWithAccessionedSequence<R> | R)[];
  species?: (AnyTaxon<R> | R)[];
  tissue?: Anatomy<R> | R;
  tissueLayer?: Anatomy<R> | R;
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'Cell';
  className: string;
  rnaMarker?: (EntityWithAccessionedSequence<R> | R)[];
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface CellDevelopmentStep<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name?: string[];
  releaseDate?: string;
  releaseStatus?: string;
  speciesName?: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric?: boolean;
  systematicName?: string;
  category?: string;
  catalystActivity?: (CatalystActivity<R> | R)[];
  catalystActivityReference?: CatalystActivityReference<R> | R;
  entityFunctionalStatus?: (EntityFunctionalStatus<R> | R)[];
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  input?: (PhysicalEntity<R> | R)[];
  output?: (PhysicalEntity<R> | R)[];
  normalReaction?: ReactionLikeEvent<R> | R;
  diseaseReactions?: DiseaseReaction<R>[];
  regulatedBy?: (Regulation<R> | R)[];
  regulationReference?: (RegulationReference<R> | R)[];
  requiredInputComponent?: (PhysicalEntity<R> | R)[];
  hasInteraction?: (InteractionEvent<R> | R)[];
  reactionType?: (ReactionType<R> | R)[];
  tissue?: Anatomy<R> | R;
  className: string;
  inputs?: Input<R>[];
  outputs?: Output<R>[];
  diseaseReaction?: (ReactionLikeEvent<R> | R)[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'CellDevelopmentStep';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface CellLineagePath<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name?: string[];
  releaseDate?: string;
  releaseStatus?: string;
  speciesName?: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  doi?: string;
  hasDiagram?: boolean;
  hasEHLD?: boolean;
  isCanonical?: string;
  lastUpdatedDate?: string;
  hasEvent?: (Event<R> | R)[];
  normalPathway?: AnyPathway<R> | R;
  diseasePathways?: (AnyPathway<R> | R)[];
  tissue?: Anatomy<R> | R;
  events?: HasEvent<R>[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'CellLineagePath';
  className: string;
}

/** Recorded 5 times. */
export interface ChemicalDrug<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth: number;
  name: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  referenceEntity?: ReferenceTherapeutic<R> | R;
  hasCompartment?: HasCompartment<R>[];
  inDisease: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'ChemicalDrug';
  className: string;
}

/** Recorded 213 times. */
export interface Complex<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric?: boolean;
  hasComponent?: (PhysicalEntity<R> | R)[];
  stoichiometryKnown?: boolean;
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  includedLocation?: (Compartment<R> | R)[];
  species?: (Species<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  components?: HasComponent<R>[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'Complex';
  className?: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface DBInfo<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  releaseNumber?: number;
  name?: string;
  checksum?: number;
  version?: number;
  className: string;
  schemaClass: 'DBInfo';
}

/** Recorded 97 times. */
export interface DefinedSet<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth: number;
  name: string[];
  speciesName: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isOrdered?: boolean;
  hasMember?: (PhysicalEntity<R> | R)[];
  species: (Species<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  members?: HasMember<R>[];
  className: string;
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  inDisease: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'DefinedSet';
}

/** Recorded 71 times. */
export interface Deleted<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  curatorComment?: string;
  deletedInstance?: (DeletedInstance<R> | R)[];
  reason?: DeletedControlledVocabulary<R> | R;
  replacementInstances: (Deletable<R> | R)[];
  deletedInstanceDbId: number[];
  className: string;
  schemaClass: 'Deleted';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface DeletedControlledVocabulary<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  name?: string[];
  className: string;
  schemaClass: 'DeletedControlledVocabulary';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface DeletedInstance<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  clazz?: string;
  deletedInstanceDbId?: number;
  name?: string;
  deletedStId?: string;
  species?: (AnyTaxon<R> | R)[];
  className: string;
  schemaClass: 'DeletedInstance';
}

/** Recorded once. */
export interface Depolymerisation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease: boolean;
  isInferred: boolean;
  maxDepth: number;
  name: string[];
  releaseDate: string;
  releaseStatus?: string;
  speciesName: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric: boolean;
  systematicName?: string;
  category: string;
  catalystActivity?: (CatalystActivity<R> | R)[];
  catalystActivityReference?: CatalystActivityReference<R> | R;
  entityFunctionalStatus?: (EntityFunctionalStatus<R> | R)[];
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  input?: (PhysicalEntity<R> | R)[];
  output?: (PhysicalEntity<R> | R)[];
  normalReaction?: ReactionLikeEvent<R> | R;
  diseaseReactions?: DiseaseReaction<R>[];
  regulatedBy?: (Regulation<R> | R)[];
  regulationReference?: (RegulationReference<R> | R)[];
  requiredInputComponent?: (PhysicalEntity<R> | R)[];
  hasInteraction?: (InteractionEvent<R> | R)[];
  reactionType?: (ReactionType<R> | R)[];
  className: string;
  inputs?: Input<R>[];
  outputs?: Output<R>[];
  diseaseReaction?: (ReactionLikeEvent<R> | R)[];
  composedOf?: Default<R>[];
  hasCompartment: HasCompartment<R>[];
  eventOfPathways: EventOf<R>[];
  schemaClass: 'Depolymerisation';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface DirectedInteraction<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceDatabase?: ReferenceDatabase<R> | R;
  databaseName?: string;
  score?: number;
  accession?: string[];
  pubmed?: string[];
  url?: string;
  source?: ReferenceEntity<R> | R;
  target?: ReferenceEntity<R> | R;
  className: string;
  schemaClass: 'DirectedInteraction';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface DrugActionType<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  name?: string[];
  instanceOf?: (DrugActionType<R> | R)[];
  className: string;
  schemaClass: 'DrugActionType';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface DrugType<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  name?: string[];
  className: string;
  schemaClass: 'DrugType';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface EntityFunctionalStatus<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  functionalStatus?: (FunctionalStatus<R> | R)[];
  diseaseEntity?: PhysicalEntity<R> | R;
  normalEntity?: PhysicalEntity<R> | R;
  className: string;
  schemaClass: 'EntityFunctionalStatus';
}

/** Recorded 967 times. */
export interface EntityWithAccessionedSequence<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  species?: AnyTaxon<R> | R;
  endCoordinate?: number;
  referenceType?: string;
  startCoordinate?: number;
  hasModifiedResidue?: (AbstractModifiedResidue<R> | R)[];
  referenceEntity?: ReferenceSequence<R> | R;
  className?: string;
  modifiedResidues?: HasModifiedResidue<R>[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'EntityWithAccessionedSequence';
}

/** Recorded 19 times. */
export interface FailedReaction<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease: boolean;
  isInferred: boolean;
  maxDepth: number;
  name: string[];
  releaseDate: string;
  releaseStatus?: string;
  speciesName: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric: boolean;
  systematicName?: string;
  category: string;
  catalystActivity: (CatalystActivity<R> | R)[];
  catalystActivityReference?: CatalystActivityReference<R> | R;
  entityFunctionalStatus?: (EntityFunctionalStatus<R> | R)[];
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  input?: (PhysicalEntity<R> | R)[];
  output?: (PhysicalEntity<R> | R)[];
  normalReaction?: ReactionLikeEvent<R> | R;
  diseaseReactions?: DiseaseReaction<R>[];
  regulatedBy?: (Regulation<R> | R)[];
  regulationReference?: (RegulationReference<R> | R)[];
  requiredInputComponent?: (PhysicalEntity<R> | R)[];
  hasInteraction?: (InteractionEvent<R> | R)[];
  reactionType?: (ReactionType<R> | R)[];
  className: string;
  inputs?: Input<R>[];
  outputs?: Output<R>[];
  diseaseReaction?: (ReactionLikeEvent<R> | R)[];
  composedOf: Default<R>[];
  hasCompartment: HasCompartment<R>[];
  eventOfPathways: EventOf<R>[];
  schemaClass: 'FailedReaction';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface FragmentDeletionModification<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  endPositionInReferenceSequence?: number;
  startPositionInReferenceSequence?: number;
  className: string;
  schemaClass: 'FragmentDeletionModification';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface FragmentInsertionModification<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  endPositionInReferenceSequence?: number;
  startPositionInReferenceSequence?: number;
  coordinate?: number;
  className: string;
  schemaClass: 'FragmentInsertionModification';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface FragmentReplacedModification<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  endPositionInReferenceSequence?: number;
  startPositionInReferenceSequence?: number;
  alteredAminoAcidFragment?: string;
  className: string;
  schemaClass: 'FragmentReplacedModification';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface FunctionalStatus<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  functionalStatusType?: FunctionalStatusType<R> | R;
  structuralVariant?: SequenceOntology<R> | R;
  className: string;
  schemaClass: 'FunctionalStatus';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface FunctionalStatusType<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  name?: string[];
  className: string;
  schemaClass: 'FunctionalStatusType';
}

/** Recorded 137 times. */
export interface GenomeEncodedEntity<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth: number;
  name: string[];
  speciesName: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  species?: AnyTaxon<R> | R;
  className: string;
  hasCompartment?: HasCompartment<R>[];
  inDisease: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'GenomeEncodedEntity';
}

/** Recorded once. */
export interface GroupModifiedResidue<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence: ReferenceSequence<R> | R;
  coordinate?: number;
  psiMod: PsiMod<R> | R;
  modification: GraphObject<R> | R;
  className: string;
  schemaClass: 'GroupModifiedResidue';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface InterChainCrosslinkedResidue<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  coordinate?: number;
  psiMod?: PsiMod<R> | R;
  secondCoordinate?: number;
  modification?: GraphObject<R> | R;
  equivalentTo?: (InterChainCrosslinkedResidue<R> | R)[];
  secondReferenceSequence?: (ReferenceSequence<R> | R)[];
  className: string;
  schemaClass: 'InterChainCrosslinkedResidue';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface InteractionEvent<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name?: string[];
  releaseDate?: string;
  releaseStatus?: string;
  speciesName?: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  partners?: (PhysicalEntity<R> | R)[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'InteractionEvent';
  className: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface IntraChainCrosslinkedResidue<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  coordinate?: number;
  psiMod?: PsiMod<R> | R;
  secondCoordinate?: number;
  modification?: GraphObject<R> | R;
  className: string;
  schemaClass: 'IntraChainCrosslinkedResidue';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface MarkerReference<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  literatureReference?: (Publication<R> | R)[];
  marker?: EntityWithAccessionedSequence<R> | R;
  cell?: (Cell<R> | R)[];
  className: string;
  schemaClass: 'MarkerReference';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface ModifiedNucleotide<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  coordinate?: number;
  modification?: GraphObject<R> | R;
  className: string;
  schemaClass: 'ModifiedNucleotide';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface ModifiedResidue<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  coordinate?: number;
  psiMod?: PsiMod<R> | R;
  className: string;
  schemaClass: 'ModifiedResidue';
}

/** Recorded 211 times. */
export interface NegativeGeneExpressionRegulation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  activeUnit?: (PhysicalEntity<R> | R)[];
  activity?: GO_MolecularFunction<R> | R;
  authored?: InstanceEdit<R> | R;
  edited?: (InstanceEdit<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredTo?: (Regulation<R> | R)[];
  inferredFrom?: (Regulation<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  regulatedEntity: (ReactionLikeEvent<R> | R)[];
  regulator?: PhysicalEntity<R> | R;
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  schemaClass: 'NegativeGeneExpressionRegulation';
  className: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface NegativePrecedingEvent<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  comment?: string;
  precedingEvent?: (Event<R> | R)[];
  reason?: NegativePrecedingEventReason<R> | R;
  className: string;
  schemaClass: 'NegativePrecedingEvent';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface NegativePrecedingEventReason<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  name?: string[];
  className: string;
  schemaClass: 'NegativePrecedingEventReason';
}

/** Recorded 238 times. */
export interface NegativeRegulation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  activeUnit?: (PhysicalEntity<R> | R)[];
  activity?: GO_MolecularFunction<R> | R;
  authored?: InstanceEdit<R> | R;
  edited?: (InstanceEdit<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredTo?: (Regulation<R> | R)[];
  inferredFrom?: (Regulation<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  regulatedEntity?: (ReactionLikeEvent<R> | R)[];
  regulator?: PhysicalEntity<R> | R;
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  schemaClass: 'NegativeRegulation';
  className: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface NonsenseMutation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  coordinate?: number;
  psiMod?: (PsiMod<R> | R)[];
  className: string;
  schemaClass: 'NonsenseMutation';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface Ontology<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  ontology?: string;
  className: string;
  schemaClass: 'Ontology';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface OtherEntity<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'OtherEntity';
  className: string;
}

/** Recorded 13,416 times. */
export interface Pathway<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name?: string[];
  releaseDate?: string;
  releaseStatus?: string;
  speciesName: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  doi?: string;
  hasDiagram?: boolean;
  hasEHLD?: boolean;
  isCanonical?: string;
  lastUpdatedDate?: string;
  hasEvent?: (Event<R> | R)[];
  normalPathway?: AnyPathway<R> | R;
  diseasePathways?: (AnyPathway<R> | R)[];
  events?: HasEvent<R>[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'Pathway';
  className?: string;
}

/** Recorded once. */
export interface Polymer<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth: number;
  name: string[];
  speciesName: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  maxUnitCount?: number;
  minUnitCount: number;
  repeatedUnit?: (PhysicalEntity<R> | R)[];
  species: (Species<R> | R)[];
  repeatedUnits?: RepeatedUnit<R>[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  inDisease: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'Polymer';
  className: string;
}

/** Recorded once. */
export interface Polymerisation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease: boolean;
  isInferred: boolean;
  maxDepth: number;
  name: string[];
  releaseDate: string;
  releaseStatus?: string;
  speciesName: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric: boolean;
  systematicName?: string;
  category: string;
  catalystActivity?: (CatalystActivity<R> | R)[];
  catalystActivityReference?: CatalystActivityReference<R> | R;
  entityFunctionalStatus?: (EntityFunctionalStatus<R> | R)[];
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  input?: (PhysicalEntity<R> | R)[];
  output?: (PhysicalEntity<R> | R)[];
  normalReaction?: ReactionLikeEvent<R> | R;
  diseaseReactions?: DiseaseReaction<R>[];
  regulatedBy?: (Regulation<R> | R)[];
  regulationReference?: (RegulationReference<R> | R)[];
  requiredInputComponent?: (PhysicalEntity<R> | R)[];
  hasInteraction?: (InteractionEvent<R> | R)[];
  reactionType?: (ReactionType<R> | R)[];
  className: string;
  inputs?: Input<R>[];
  outputs?: Output<R>[];
  diseaseReaction?: (ReactionLikeEvent<R> | R)[];
  composedOf?: Default<R>[];
  hasCompartment: HasCompartment<R>[];
  eventOfPathways: EventOf<R>[];
  schemaClass: 'Polymerisation';
}

/** Recorded 919 times. */
export interface PositiveGeneExpressionRegulation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  activeUnit?: (PhysicalEntity<R> | R)[];
  activity?: GO_MolecularFunction<R> | R;
  authored?: InstanceEdit<R> | R;
  edited?: (InstanceEdit<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredTo?: (Regulation<R> | R)[];
  inferredFrom?: (Regulation<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  regulatedEntity: (ReactionLikeEvent<R> | R)[];
  regulator?: PhysicalEntity<R> | R;
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  schemaClass: 'PositiveGeneExpressionRegulation';
  className: string;
}

/** Recorded 161 times. */
export interface PositiveRegulation<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  activeUnit?: (PhysicalEntity<R> | R)[];
  activity?: GO_MolecularFunction<R> | R;
  authored?: InstanceEdit<R> | R;
  edited?: (InstanceEdit<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredTo?: (Regulation<R> | R)[];
  inferredFrom?: (Regulation<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  regulatedEntity?: (ReactionLikeEvent<R> | R)[];
  regulator?: PhysicalEntity<R> | R;
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  schemaClass: 'PositiveRegulation';
  className: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface ProteinDrug<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  referenceEntity?: ReferenceTherapeutic<R> | R;
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'ProteinDrug';
  className: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface RNADrug<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  referenceEntity?: ReferenceTherapeutic<R> | R;
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'RNADrug';
  className: string;
}

/** Recorded 3,139 times. */
export interface Reaction<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name?: string[];
  releaseDate?: string;
  releaseStatus?: string;
  speciesName?: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  isChimeric?: boolean;
  systematicName?: string;
  category?: string;
  catalystActivity?: (CatalystActivity<R> | R)[];
  catalystActivityReference?: CatalystActivityReference<R> | R;
  entityFunctionalStatus?: (EntityFunctionalStatus<R> | R)[];
  entityOnOtherCell?: (PhysicalEntity<R> | R)[];
  input?: (PhysicalEntity<R> | R)[];
  output?: (PhysicalEntity<R> | R)[];
  normalReaction?: ReactionLikeEvent<R> | R;
  diseaseReactions?: DiseaseReaction<R>[];
  regulatedBy?: (Regulation<R> | R)[];
  regulationReference?: (RegulationReference<R> | R)[];
  requiredInputComponent?: (PhysicalEntity<R> | R)[];
  hasInteraction?: (InteractionEvent<R> | R)[];
  reactionType?: (ReactionType<R> | R)[];
  reverseReaction?: Reaction<R> | R;
  className?: string;
  inputs?: Input<R>[];
  outputs?: Output<R>[];
  diseaseReaction?: (ReactionLikeEvent<R> | R)[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'Reaction';
}

/** Recorded 309 times. */
export interface ReferenceDNASequence<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName?: string;
  identifier: string;
  name?: string[];
  otherIdentifier?: string[];
  url: string;
  moleculeType?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  checksum?: string;
  comment?: string[];
  description?: string[];
  geneName?: string[];
  isSequenceChanged?: boolean;
  keyword?: string[];
  secondaryIdentifier?: string[];
  sequenceLength?: number;
  species?: Species<R> | R;
  className?: string;
  schemaClass: 'ReferenceDNASequence';
}

/** Recorded 1,442 times. */
export interface ReferenceGeneProduct<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName?: string;
  identifier: string;
  name?: string[];
  otherIdentifier?: string[];
  url: string;
  moleculeType?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  checksum?: string;
  comment?: string[];
  description?: string[];
  geneName?: string[];
  isSequenceChanged?: boolean;
  keyword?: string[];
  secondaryIdentifier?: string[];
  sequenceLength?: number;
  species?: Species<R> | R;
  chain?: string[];
  referenceGene?: (ReferenceDNASequence<R> | R)[];
  referenceTranscript?: (ReferenceRNASequence<R> | R)[];
  className?: string;
  schemaClass: 'ReferenceGeneProduct';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface ReferenceGroup<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName?: string;
  identifier?: string;
  name?: string[];
  otherIdentifier?: string[];
  url?: string;
  moleculeType?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  formula?: string;
  className: string;
  schemaClass: 'ReferenceGroup';
}

/** Recorded 25 times. */
export interface ReferenceIsoform<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName?: string;
  identifier: string;
  name?: string[];
  otherIdentifier?: string[];
  url: string;
  moleculeType?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  checksum?: string;
  comment?: string[];
  description?: string[];
  geneName?: string[];
  isSequenceChanged?: boolean;
  keyword?: string[];
  secondaryIdentifier?: string[];
  sequenceLength?: number;
  species?: Species<R> | R;
  chain?: string[];
  referenceGene?: (ReferenceDNASequence<R> | R)[];
  referenceTranscript?: (ReferenceRNASequence<R> | R)[];
  variantIdentifier?: string;
  isoformParent?: (AnyReferenceGeneProduct<R> | R)[];
  className?: string;
  schemaClass: 'ReferenceIsoform';
}

/** Recorded 132 times. */
export interface ReferenceMolecule<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName?: string;
  identifier: string;
  name?: string[];
  otherIdentifier?: string[];
  url: string;
  moleculeType?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  formula?: string;
  className?: string;
  schemaClass: 'ReferenceMolecule';
}

/** Recorded 51 times. */
export interface ReferenceRNASequence<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName: string;
  identifier: string;
  name?: string[];
  otherIdentifier?: string[];
  url: string;
  moleculeType: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  checksum?: string;
  comment?: string[];
  description?: string[];
  geneName: string[];
  isSequenceChanged?: boolean;
  keyword?: string[];
  secondaryIdentifier?: string[];
  sequenceLength?: number;
  species?: Species<R> | R;
  referenceGene?: (ReferenceDNASequence<R> | R)[];
  className: string;
  schemaClass: 'ReferenceRNASequence';
}

/** Recorded 41 times. */
export interface ReferenceTherapeutic<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  databaseName?: string;
  identifier: string;
  name?: string[];
  otherIdentifier?: string[];
  url: string;
  moleculeType?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
  physicalEntity?: (PhysicalEntity<R> | R)[];
  abbreviation?: string;
  approvalSource?: string[];
  approved?: boolean;
  inn?: string;
  type?: string;
  className?: string;
  schemaClass: 'ReferenceTherapeutic';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface RegulationReference<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  literatureReference?: (Publication<R> | R)[];
  regulatedBy?: Regulation<R> | R;
  className: string;
  schemaClass: 'RegulationReference';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface RegulationType<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  name?: string;
  className: string;
  schemaClass: 'RegulationType';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface Release<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  releaseNumber?: number;
  className: string;
  schemaClass: 'Release';
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface ReplacedResidue<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceSequence?: ReferenceSequence<R> | R;
  coordinate?: number;
  psiMod?: (PsiMod<R> | R)[];
  className: string;
  schemaClass: 'ReplacedResidue';
}

/** Recorded 21 times. */
export interface Requirement<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  releaseDate?: string;
  activeUnit?: (PhysicalEntity<R> | R)[];
  activity?: GO_MolecularFunction<R> | R;
  authored?: InstanceEdit<R> | R;
  edited?: (InstanceEdit<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredTo?: (Regulation<R> | R)[];
  inferredFrom?: (Regulation<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  regulatedEntity?: (ReactionLikeEvent<R> | R)[];
  regulator?: PhysicalEntity<R> | R;
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  schemaClass: 'Requirement';
  className: string;
}

/** Recorded 108 times. */
export interface SimpleEntity<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name?: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo?: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  referenceType?: string;
  referenceEntity?: ReferenceMolecule<R> | R;
  species?: Species<R> | R;
  className?: string;
  hasCompartment?: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  memberOfSet?: MemberOf<R>[];
  componentOfComplexes?: ComponentOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor?: InputForReactionLikeEvent<R>[];
  outputFor?: OutputForReactionLikeEvent<R>[];
  schemaClass: 'SimpleEntity';
}

/** Recorded 2 times. */
export interface SummaryEntity<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  maxDepth?: number;
  name: string[];
  speciesName?: string;
  systematicName?: string;
  authored?: InstanceEdit<R> | R;
  catalystActivities?: (CatalystActivity<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  componentOf?: (Complex<R> | R)[];
  crossReference: (DatabaseIdentifier<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  figure?: (Figure<R> | R)[];
  goCellularComponent?: AnyGO_CellularComponent<R> | R;
  inferredTo: (PhysicalEntity<R> | R)[];
  inferredFrom?: (PhysicalEntity<R> | R)[];
  isRequired?: (Requirement<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  memberOf?: (EntitySet<R> | R)[];
  candidateOf?: (CandidateSet<R> | R)[];
  negativelyRegulates?: (AnyNegativeRegulation<R> | R)[];
  positivelyRegulates?: (AnyPositiveRegulation<R> | R)[];
  repeatedUnitOf?: (Polymer<R> | R)[];
  consumedByEvent?: (ReactionLikeEvent<R> | R)[];
  producedByEvent?: (ReactionLikeEvent<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  summation?: (Summation<R> | R)[];
  cellType?: (CellType<R> | R)[];
  markingReferences?: (MarkerReference<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  summarisedEntities: (PhysicalEntity<R> | R)[];
  moleculeType: string;
  databaseName: string;
  identifier: string;
  otherIdentifier?: string[];
  url: string;
  referenceDatabase: ReferenceDatabase<R> | R;
  checksum: string;
  comment: string[];
  description: string[];
  geneName: string[];
  isSequenceChanged: boolean;
  keyword: string[];
  secondaryIdentifier: string[];
  sequenceLength: number;
  species: Species<R> | R;
  chain: string[];
  referenceGene: (ReferenceDNASequence<R> | R)[];
  referenceTranscript: (ReferenceRNASequence<R> | R)[];
  variantIdentifier?: string;
  isoformParent?: (AnyReferenceGeneProduct<R> | R)[];
  referenceType: string;
  referenceEntity: ReferenceSequence<R> | R;
  endCoordinate?: number;
  startCoordinate?: number;
  hasModifiedResidue?: (AbstractModifiedResidue<R> | R)[];
  className: string;
  modifiedResidues?: HasModifiedResidue<R>[];
  hasCompartment: HasCompartment<R>[];
  inDisease?: boolean;
  repeatedUnitOfPolymers?: RepeatedUnitForPhysicalEntity<R>[];
  componentOfComplexes: ComponentOf<R>[];
  memberOfSet: MemberOf<R>[];
  candidateOfSet?: CandidateOf<R>[];
  inputFor: InputForReactionLikeEvent<R>[];
  outputFor: OutputForReactionLikeEvent<R>[];
  schemaClass: 'SummaryEntity';
}

/** Recorded 9,831 times. */
export interface TopLevelPathway<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId: string;
  stIdVersion: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  definition?: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  maxDepth?: number;
  name: string[];
  releaseDate: string;
  releaseStatus?: string;
  speciesName: string;
  authored?: (InstanceEdit<R> | R)[];
  crossReference?: (DatabaseIdentifier<R> | R)[];
  compartment?: (Compartment<R> | R)[];
  disease?: (Disease<R> | R)[];
  edited?: (InstanceEdit<R> | R)[];
  eventOf?: (AnyPathway<R> | R)[];
  evidenceType?: EvidenceType<R> | R;
  figure?: (Figure<R> | R)[];
  precedingEvent?: (Event<R> | R)[];
  followingEvent?: (Event<R> | R)[];
  goBiologicalProcess?: GO_BiologicalProcess<R> | R;
  inferredFrom?: (Event<R> | R)[];
  literatureReference?: (Publication<R> | R)[];
  orthologousEvent?: (Event<R> | R)[];
  relatedSpecies?: (Species<R> | R)[];
  reviewed?: (InstanceEdit<R> | R)[];
  revised?: (InstanceEdit<R> | R)[];
  species?: (Species<R> | R)[];
  summation?: (Summation<R> | R)[];
  negativePrecedingEvent?: (NegativePrecedingEvent<R> | R)[];
  reviewStatus?: ReviewStatus<R> | R;
  previousReviewStatus?: ReviewStatus<R> | R;
  internalReviewed?: (InstanceEdit<R> | R)[];
  structureModified?: (InstanceEdit<R> | R)[];
  deleted?: (Deleted<R> | R)[];
  updateTrackers?: (UpdateTracker<R> | R)[];
  doi?: string;
  hasDiagram: boolean;
  hasEHLD: boolean;
  isCanonical?: string;
  lastUpdatedDate?: string;
  hasEvent?: (Event<R> | R)[];
  normalPathway?: AnyPathway<R> | R;
  diseasePathways?: (AnyPathway<R> | R)[];
  events?: HasEvent<R>[];
  composedOf?: Default<R>[];
  hasCompartment?: HasCompartment<R>[];
  eventOfPathways?: EventOf<R>[];
  schemaClass: 'TopLevelPathway';
  className?: string;
}

/** Never recorded: as the snapshot writes it, only its identity and class are required. */
export interface UndirectedInteraction<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  referenceDatabase?: ReferenceDatabase<R> | R;
  databaseName?: string;
  score?: number;
  accession?: string[];
  pubmed?: string[];
  url?: string;
  interactor?: (ReferenceEntity<R> | R)[];
  className: string;
  schemaClass: 'UndirectedInteraction';
}

/** Recorded 6 times. */
export interface UpdateTracker<R extends Ref> extends JsogFields {
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
  action: string[];
  release?: AnyRelease<R> | R;
  updatedInstance: (Trackable<R> | R)[];
  className: string;
  schemaClass: 'UpdateTracker';
}

/** A relationship entry, `candidateOf`: written whole wherever it appears, with no identity of its own. */
export interface CandidateOf<R extends Ref> {
  type: 'candidateOf';
  stoichiometry: number;
  order: number;
  element: CandidateSet<R> | R;
}

/** A relationship entry, `componentOf`: written whole wherever it appears, with no identity of its own. */
export interface ComponentOf<R extends Ref> {
  type: 'componentOf';
  stoichiometry: number;
  order: number;
  element: Complex<R> | R;
}

/** A relationship entry, `diseaseReaction`: written whole wherever it appears, with no identity of its own. */
export interface DiseaseReaction<R extends Ref> {
  type: 'diseaseReaction';
  stoichiometry: number;
  order: number;
  element: ReactionLikeEvent<R> | R;
}

/** A relationship entry, `event`: written whole wherever it appears, with no identity of its own. */
export interface EventOf<R extends Ref> {
  type: 'event';
  stoichiometry: number;
  order: number;
  element: AnyPathway<R> | R;
}

/** A relationship entry, `candidate`: written whole wherever it appears, with no identity of its own. */
export interface HasCandidate<R extends Ref> {
  type: 'candidate';
  stoichiometry: number;
  order: number;
  element: PhysicalEntity<R> | R;
}

/** A relationship entry, `compartment`: written whole wherever it appears, with no identity of its own. */
export interface HasCompartment<R extends Ref> {
  type: 'compartment';
  stoichiometry: number;
  order: number;
  element: Compartment<R> | R;
}

/** A relationship entry, `component`: written whole wherever it appears, with no identity of its own. */
export interface HasComponent<R extends Ref> {
  type: 'component';
  stoichiometry: number;
  order: number;
  element: PhysicalEntity<R> | R;
}

/** A relationship entry, `event`: written whole wherever it appears, with no identity of its own. */
export interface HasEvent<R extends Ref> {
  type: 'event';
  stoichiometry: number;
  order: number;
  element: Event<R> | R;
}

/** A relationship entry, `member`: written whole wherever it appears, with no identity of its own. */
export interface HasMember<R extends Ref> {
  type: 'member';
  stoichiometry: number;
  order: number;
  element: PhysicalEntity<R> | R;
}

/** A relationship entry, `modifiedResidue`: written whole wherever it appears, with no identity of its own. */
export interface HasModifiedResidue<R extends Ref> {
  type: 'modifiedResidue';
  stoichiometry: number;
  order: number;
  element: AbstractModifiedResidue<R> | R;
}

/** A relationship entry, `input`: written whole wherever it appears, with no identity of its own. */
export interface Input<R extends Ref> {
  type: 'input';
  stoichiometry: number;
  order: number;
  element: PhysicalEntity<R> | R;
}

/** A relationship entry, `inputOf`: written whole wherever it appears, with no identity of its own. */
export interface InputForReactionLikeEvent<R extends Ref> {
  type: 'inputOf';
  stoichiometry: number;
  order: number;
  element: ReactionLikeEvent<R> | R;
}

/** A relationship entry, `memberOf`: written whole wherever it appears, with no identity of its own. */
export interface MemberOf<R extends Ref> {
  type: 'memberOf';
  stoichiometry: number;
  order: number;
  element: EntitySet<R> | R;
}

/** A relationship entry, `output`: written whole wherever it appears, with no identity of its own. */
export interface Output<R extends Ref> {
  type: 'output';
  stoichiometry: number;
  order: number;
  element: PhysicalEntity<R> | R;
}

/** A relationship entry, `outputOf`: written whole wherever it appears, with no identity of its own. */
export interface OutputForReactionLikeEvent<R extends Ref> {
  type: 'outputOf';
  stoichiometry: number;
  order: number;
  element: ReactionLikeEvent<R> | R;
}

/** A relationship entry, `repeatedUnit`: written whole wherever it appears, with no identity of its own. */
export interface RepeatedUnit<R extends Ref> {
  type: 'repeatedUnit';
  stoichiometry: number;
  order: number;
  element: PhysicalEntity<R> | R;
}

/** A relationship entry, `repeatedUnitOf`: written whole wherever it appears, with no identity of its own. */
export interface RepeatedUnitForPhysicalEntity<R extends Ref> {
  type: 'repeatedUnitOf';
  stoichiometry: number;
  order: number;
  element: Polymer<R> | R;
}

/** A composition entry (`composedOf`): an element, how many times it is there and in what order; its type is the relationship it was read from (an input, a catalyst, a regulation, a member…), so its element may be any object. Every recorded one has a reference as its element. */
export interface Default<R extends Ref> {
  type: string;
  stoichiometry: number;
  order: number;
  element: GraphObject<R> | R;
}
