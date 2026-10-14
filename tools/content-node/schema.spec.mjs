// @vitest-environment node
//
// The two questions Java answers by reflection over graph-core's domain model,
// answered here from a table: is this a class, and does it have a species?
// Every expectation below was measured -- against the graph's labels, against
// Java's answers, and by reflection over the graph-core jar the deployed
// ContentService runs -- on 14 Oct 2026, Release 97.
import { describe, expect, it } from 'vitest';
import {
  isSchemaClass,
  isSpeciesClass,
  SCHEMA_CLASSES,
  schemaClassOf,
  supertypes,
} from './schema.mjs';

/** `CALL db.labels()` on the Release 97 graph: every label a node carries. */
const GRAPH_LABELS = [
  'DatabaseObject',
  'Event',
  'Pathway',
  'ReactionLikeEvent',
  'Reaction',
  'PhysicalEntity',
  'Complex',
  'EntitySet',
  'GenomeEncodedEntity',
  'ReferenceEntity',
  'Taxon',
  'Species',
  'Person',
  'LiteratureReference',
  'ReferenceIsoform',
  'ExternalOntology',
  'Trackable',
  'Deletable',
  'TopLevelPathway',
  'EntityWithAccessionedSequence',
  'ReferenceGeneProduct',
  'ReferenceSequence',
  'ReferenceDNASequence',
  'DatabaseIdentifier',
  'ReferenceDatabase',
  'InstanceEdit',
  'Affiliation',
  'Compartment',
  'GO_CellularComponent',
  'GO_Term',
  'ModifiedResidue',
  'TranslationalModification',
  'AbstractModifiedResidue',
  'PsiMod',
  'Publication',
  'Summation',
  'ReviewStatus',
  'ControlledVocabulary',
  'SimpleEntity',
  'ReferenceMolecule',
  'DefinedSet',
  'Depolymerisation',
  'Polymer',
  'GroupModifiedResidue',
  'ReplacedResidue',
  'GeneticallyModifiedResidue',
  'Polymerisation',
  'BlackBoxEvent',
  'CatalystActivity',
  'GO_MolecularFunction',
  'CandidateSet',
  'PositiveRegulation',
  'Regulation',
  'RegulationReference',
  'ControlReference',
  'EvidenceType',
  'GO_BiologicalProcess',
  'CatalystActivityReference',
  'PositiveGeneExpressionRegulation',
  'Figure',
  'InterChainCrosslinkedResidue',
  'CrosslinkedResidue',
  'ReferenceGroup',
  'NegativeRegulation',
  'NegativePrecedingEvent',
  'NegativePrecedingEventReason',
  'NegativeGeneExpressionRegulation',
  'OtherEntity',
  'ReferenceRNASequence',
  'ChemicalDrug',
  'Drug',
  'ReferenceTherapeutic',
  'Disease',
  'Book',
  'Requirement',
  'URL',
  'ProteinDrug',
  'DrugActionType',
  'ReactionType',
  'IntraChainCrosslinkedResidue',
  'ModifiedNucleotide',
  'TranscriptionalModification',
  'CellType',
  'FragmentInsertionModification',
  'FragmentModification',
  'FragmentDeletionModification',
  'RNADrug',
  'FailedReaction',
  'EntityFunctionalStatus',
  'FunctionalStatus',
  'FunctionalStatusType',
  'SequenceOntology',
  'FragmentReplacedModification',
  'NonsenseMutation',
  'CellLineagePath',
  'CellDevelopmentStep',
  'Cell',
  'MarkerReference',
  'Anatomy',
  'Deleted',
  'MetaDatabaseObject',
  'DeletedInstance',
  'DeletedControlledVocabulary',
  'Release',
  'DBInfo',
  'UpdateTracker',
  'UndirectedInteraction',
  'Interaction',
];

describe('isSchemaClass, Java\'s Class.forName("…domain.model." + name)', () => {
  it('knows the 113 classes of graph-core 3.0.0 domain.model, one per source file', () => {
    expect(Object.keys(SCHEMA_CLASSES)).toHaveLength(113);
  });

  it('accepts every label the graph holds', () => {
    expect(GRAPH_LABELS.filter((label) => !isSchemaClass(label))).toEqual([]);
  });

  it('accepts classes no node is labelled with, which Java counts as 0', () => {
    for (const name of [
      'Ontology',
      'DrugType',
      'RegulationType',
      'DirectedInteraction',
      'InteractionEvent',
    ]) {
      expect(isSchemaClass(name), name).toBe(true);
      expect(GRAPH_LABELS).not.toContain(name);
    }
  });

  it("accepts the AspectJ closures woven into the jar's model package, as Class.forName does", () => {
    expect(isSchemaClass('CandidateSet$AjcClosure5')).toBe(true);
    expect(isSchemaClass('PhysicalEntity$AjcClosure117')).toBe(true);
    expect(isSchemaClass('Event$AjcClosure99')).toBe(true);
  });

  it('refuses what Java does not find: wrong case, unknown, other packages, prototype keys', () => {
    for (const name of [
      'pathway',
      'PATHWAY',
      'Foo',
      '',
      'Pathway.json',
      'Pathway;x',
      'DatabaseObjectLike',
      'CompositionAggregator',
      'SimpleDatabaseObject',
      'CandidateSet$AjcClosure1',
      'CandidateSet$AjcClosure',
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(isSchemaClass(name), name).toBe(false);
    }
  });
});

describe('isSpeciesClass, SchemaService.isValidSpeciesClass (getMethod("getSpecies"))', () => {
  // By reflection over the deployed graph-core jar: every class in the model
  // package for which getMethod("getSpecies") succeeds. 27 of them.
  const REFLECTED = [
    'BlackBoxEvent',
    'CandidateSet',
    'Cell',
    'CellDevelopmentStep',
    'CellLineagePath',
    'Complex',
    'DefinedSet',
    'DeletedInstance',
    'Depolymerisation',
    'EntitySet',
    'EntityWithAccessionedSequence',
    'Event',
    'FailedReaction',
    'GenomeEncodedEntity',
    'InteractionEvent',
    'Pathway',
    'Polymer',
    'Polymerisation',
    'Reaction',
    'ReactionLikeEvent',
    'ReferenceDNASequence',
    'ReferenceGeneProduct',
    'ReferenceIsoform',
    'ReferenceRNASequence',
    'ReferenceSequence',
    'SimpleEntity',
    'TopLevelPathway',
  ];

  it('is exactly the classes that declare or inherit getSpecies', () => {
    const derived = Object.keys(SCHEMA_CLASSES).filter(isSpeciesClass).sort();
    expect(derived).toEqual(REFLECTED);
  });

  it('is false for PhysicalEntity, Drug, OtherEntity and the rest that have no species', () => {
    for (const name of [
      'PhysicalEntity',
      'Drug',
      'ChemicalDrug',
      'OtherEntity',
      'Person',
      'Species',
      'Taxon',
      'ReferenceEntity',
      'ReferenceMolecule',
      'DatabaseObject',
      'Regulation',
    ]) {
      expect(isSpeciesClass(name), name).toBe(false);
    }
  });

  it('is false for a closure and for anything that is not a class', () => {
    expect(isSpeciesClass('Event$AjcClosure3')).toBe(false);
    expect(isSpeciesClass('Foo')).toBe(false);
    expect(isSpeciesClass('constructor')).toBe(false);
  });
});

describe('supertypes, the model-package classes a class is assignable to', () => {
  // Each checked against Class.isAssignableFrom over the deployed jar.
  it('follows superclasses and the Trackable / Deletable interfaces', () => {
    expect([...supertypes('NegativeGeneExpressionRegulation')].sort()).toEqual([
      'DatabaseObject',
      'Deletable',
      'NegativeGeneExpressionRegulation',
      'NegativeRegulation',
      'Regulation',
    ]);
    expect([...supertypes('EntityWithAccessionedSequence')].sort()).toEqual([
      'DatabaseObject',
      'Deletable',
      'EntityWithAccessionedSequence',
      'GenomeEncodedEntity',
      'PhysicalEntity',
      'Trackable',
    ]);
    expect([...supertypes('DBInfo')].sort()).toEqual([
      'DBInfo',
      'DatabaseObject',
      'MetaDatabaseObject',
      'Release',
    ]);
    expect([...supertypes('Trackable')]).toEqual(['Trackable']);
  });

  it('names only classes in the table', () => {
    const unknown = Object.values(SCHEMA_CLASSES)
      .flat()
      .filter((parent) => !(parent in SCHEMA_CLASSES));
    expect(unknown).toEqual([]);
  });
});

describe('schemaClassOf, DatabaseObjectUtils.getSchemaClass(labels)', () => {
  it('takes the most specific class, whatever order the labels come in', () => {
    // Label orders as the graph returns them.
    expect(schemaClassOf(['DatabaseObject', 'Deletable', 'Regulation', 'NegativeRegulation'])).toBe(
      'NegativeRegulation'
    );
    expect(
      schemaClassOf([
        'DatabaseObject',
        'TranslationalModification',
        'AbstractModifiedResidue',
        'GroupModifiedResidue',
      ])
    ).toBe('GroupModifiedResidue');
    expect(
      schemaClassOf([
        'DatabaseObject',
        'PhysicalEntity',
        'GenomeEncodedEntity',
        'Trackable',
        'Deletable',
      ])
    ).toBe('GenomeEncodedEntity');
    expect(schemaClassOf(['DatabaseObject', 'MetaDatabaseObject', 'Release', 'DBInfo'])).toBe(
      'DBInfo'
    );
  });

  it("keeps Java's left-to-right rule, which an interface first can steer", () => {
    // Object -> Trackable; DatabaseObject is not a Trackable, Event is.
    expect(schemaClassOf(['Trackable', 'DatabaseObject', 'Event', 'Pathway'])).toBe('Pathway');
    // Neither interface is assignable to the other: the first one stays.
    expect(schemaClassOf(['Deletable', 'Trackable'])).toBe('Deletable');
  });

  it('skips labels that are not classes, and says Object when none is', () => {
    expect(schemaClassOf(['Foo', 'DatabaseObject', 'Bar', 'Person'])).toBe('Person');
    expect(schemaClassOf([])).toBe('Object');
    expect(schemaClassOf(['Foo'])).toBe('Object');
  });
});
