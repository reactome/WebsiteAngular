// Reactome schema-class → SVG icon mapping, mirroring
// pathway-browser's IconService.reactomeSubjectIcons so the website
// search results render the same icons as the pathway-browser search.
// SVG files live in projects/pathway-browser/src/assets/icons/reactome-subject/
// and are served at /assets/icons/reactome-subject/<route>.svg via angular.json.

export interface SubjectIcon {
  name: string; // svgIcon name used in <mat-icon [svgIcon]="...">
  tooltip: string; // human-readable label
  route: string; // filename under /assets/icons/reactome-subject/<route>.svg
}

const protein: SubjectIcon = { name: 'protein', tooltip: 'Protein', route: 'protein' };
const negativeRegulation: SubjectIcon = {
  name: 'negative-regulation',
  tooltip: 'Negatively regulates Reaction',
  route: 'negative-regulation',
};
const positiveRegulation: SubjectIcon = {
  name: 'positive-regulation',
  tooltip: 'Positively regulates Reaction',
  route: 'positive-regulation',
};
const referenceGroup: SubjectIcon = {
  name: 'reference-group',
  tooltip: 'Reference group',
  route: 'reference-group',
};
const geneticallyModifiedResidue: SubjectIcon = {
  name: 'genetically-modified-residue',
  tooltip: 'Genetically Modified Residue',
  route: 'genetically-modified-residue',
};
const binding: SubjectIcon = {
  name: 'binding',
  tooltip: 'Association/Binding reaction',
  route: 'binding',
};
const dissociation: SubjectIcon = {
  name: 'dissociation',
  tooltip: 'Dissociation reaction',
  route: 'dissociation',
};
const omitted: SubjectIcon = { name: 'omitted', tooltip: 'Omitted reaction', route: 'omitted' };
const transition: SubjectIcon = {
  name: 'transition',
  tooltip: 'Transition reaction',
  route: 'transition',
};
const uncertain: SubjectIcon = {
  name: 'uncertain',
  tooltip: 'Uncertain reaction',
  route: 'uncertain',
};
const pathway: SubjectIcon = { name: 'pathway', tooltip: 'Pathway', route: 'pathway' };

export const SUBJECT_ICONS: Record<string, SubjectIcon> = {
  Pathway: pathway,
  TopLevelPathway: pathway,
  BlackBoxEvent: { name: 'omitted', tooltip: 'Black Box Event', route: 'omitted' },
  EntityWithAccessionedSequence: protein,
  Complex: { name: 'complex', tooltip: 'Complex', route: 'complex' },
  SimpleEntity: { name: 'small-molecule', tooltip: 'Simple Entity', route: 'small-molecule' },
  ReferenceMolecule: { name: 'small-molecule', tooltip: 'Simple Entity', route: 'small-molecule' },
  Cell: { name: 'cell', tooltip: 'Cell Type', route: 'cell' },
  DefinedSet: { name: 'defined-set', tooltip: 'Defined Set', route: 'defined-set' },
  OpenSet: { name: 'defined-set', tooltip: 'Open Set', route: 'defined-set' },
  EntitySet: { name: 'defined-set', tooltip: 'Entity Set', route: 'defined-set' },
  OtherEntity: { name: 'other-entity', tooltip: 'Other Entity', route: 'other-entity' },
  Polymer: { name: 'polymer', tooltip: 'Polymer', route: 'polymer' },
  CandidateSet: { name: 'candidate-set', tooltip: 'Candidate Set', route: 'candidate-set' },
  ReferenceDNASequence: { name: 'gene', tooltip: 'DNA Sequence', route: 'gene' },
  ReferenceRNASequence: { name: 'RNA', tooltip: 'RNA Sequence', route: 'RNA' },
  ReferenceGeneProduct: protein,
  ReferenceTherapeutic: { name: 'chemical-drug', tooltip: 'Drug', route: 'chemical-drug' },
  ReferenceIsoform: protein,
  Interactor: { name: 'interactor', tooltip: 'Interactor', route: 'interactor' },
  GenomeEncodedEntity: {
    name: 'genome-encoded-entity',
    tooltip: 'Genome Encoded Entity',
    route: 'genome-encoded-entity',
  },
  ProteinDrug: { name: 'protein-drug', tooltip: 'Protein Drug', route: 'protein-drug' },
  ChemicalDrug: { name: 'chemical-drug', tooltip: 'Chemical Drug', route: 'chemical-drug' },
  Polymerisation: { name: 'binding', tooltip: 'Polymerisation', route: 'binding' },
  Depolymerisation: { name: 'dissociation', tooltip: 'Depolymerisation', route: 'dissociation' },
  FailedReaction: { name: 'failed-reaction', tooltip: 'Failed Reaction', route: 'failed-reaction' },
  CellLineagePath: pathway,
  CatalystActivity: {
    name: 'catalyst-activity',
    tooltip: 'Catalyst Activity',
    route: 'catalyst-activity',
  },
  NegativeRegulation: negativeRegulation,
  NegativeGeneExpressionRegulation: negativeRegulation,
  PositiveRegulation: positiveRegulation,
  PositiveGeneExpressionRegulation: positiveRegulation,
  Requirement: { name: 'requirement', tooltip: 'Requirement for Reaction', route: 'requirement' },
  GroupModifiedResidue: referenceGroup,
  ModifiedResidue: referenceGroup,
  InterChainCrosslinkedResidue: referenceGroup,
  IntraChainCrosslinkedResidue: referenceGroup,
  GeneticallyModifiedResidue: geneticallyModifiedResidue,
  TranscriptionalModification: geneticallyModifiedResidue,
  ModifiedNucleotide: geneticallyModifiedResidue,
  FragmentModification: geneticallyModifiedResidue,
  FragmentDeletionModification: geneticallyModifiedResidue,
  FragmentInsertionModification: geneticallyModifiedResidue,
  FragmentReplacedModification: geneticallyModifiedResidue,
  ReplacedResidue: geneticallyModifiedResidue,
  NonsenseMutation: geneticallyModifiedResidue,
  Reaction: binding,
  binding,
  dissociation,
  omitted,
  transition,
  uncertain,
  // Search-result shortcut labels (sometimes the API returns the friendly name
  // rather than the schema class):
  Protein: protein,
  Gene: { name: 'gene', tooltip: 'Gene', route: 'gene' },
  RNA: { name: 'RNA', tooltip: 'RNA', route: 'RNA' },
  Icon: { name: 'icon', tooltip: 'Icon', route: 'icon' },
};

const FALLBACK: SubjectIcon = { name: 'pathway', tooltip: 'Pathway', route: 'pathway' };

export function getSubjectIcon(typeKey: string | null | undefined): SubjectIcon {
  if (!typeKey) return FALLBACK;
  return SUBJECT_ICONS[typeKey] || FALLBACK;
}
