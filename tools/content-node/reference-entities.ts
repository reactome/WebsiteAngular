/**
 * Reference entities as graph-core's ReferenceEntity classes write them
 * (spec 014, research R1 layer 6), shared by the mapping and reference
 * endpoints. Moved unchanged from service.ts.
 */
import { only } from './answers.ts';

/**
 * The ReferenceEntity classes, most specific first: a node carries the labels
 * of its class and every superclass, in no reliable order (an isoform lists
 * ReferenceGeneProduct after ReferenceIsoform), and graph-core maps it to the
 * most specific -- which is also what `className` says, even on the two nodes
 * whose schemaClass property reads "6".
 */
const REFERENCE_CLASSES = [
  'ReferenceIsoform',
  'ReferenceGeneProduct',
  'ReferenceDNASequence',
  'ReferenceRNASequence',
  'ReferenceTherapeutic',
  'ReferenceMolecule',
  'ReferenceGroup',
  'ReferenceSequence',
  'ReferenceEntity',
];

/** What each class's constructor sets moleculeType to; ReferenceGroup sets none. */
const MOLECULE_TYPES = {
  ReferenceIsoform: 'Protein',
  ReferenceGeneProduct: 'Protein',
  ReferenceDNASequence: 'Entity',
  ReferenceRNASequence: 'Entity',
  ReferenceSequence: 'Entity',
  ReferenceTherapeutic: 'ChemicalDrug',
  ReferenceMolecule: 'Chemical',
};

/**
 * A ReferenceEntity as graph-core serialises a bare node, whatever its class:
 * one key order fits them all, measured from Java over 16,000 entities of six
 * classes. Stored but never written: ReferenceMolecule's `trivial`.
 */
export function referenceEntityJson(node, labels) {
  const className = REFERENCE_CLASSES.find((name) => labels.includes(name)) ?? 'ReferenceEntity';
  const moleculeType = MOLECULE_TYPES[className];
  return {
    ...only(node, [
      'dbId',
      'displayName',
      'stId',
      'databaseName',
      'identifier',
      'name',
      'otherIdentifier',
      'url',
    ]),
    ...(moleculeType && { moleculeType }),
    ...only(node, [
      'formula',
      'checksum',
      'comment',
      'description',
      'geneName',
      'isSequenceChanged',
      'keyword',
      'secondaryIdentifier',
      'sequenceLength',
      'chain',
      'variantIdentifier',
      'abbreviation',
      'approvalSource',
      'approved',
      'inn',
      'type',
    ]),
    className,
    ...only(node, ['schemaClass']),
  };
}
