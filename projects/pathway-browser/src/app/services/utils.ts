import { Event } from '../model/graph/event/event.model';
import { DatabaseObject } from '../model/graph/database-object.model';
import { Pathway } from '../model/graph/event/pathway.model';
import { ReactionLikeEvent } from '../model/graph/event/reaction-like-event.model';
import { PhysicalEntity } from '../model/graph/physical-entity/physical-entity.model';
import { TopLevelPathway } from '../model/graph/event/top-level-pathway.model';
import { CellLineagePath } from '../model/graph/event/cell-lineage-path.model';
import { EntityWithAccessionedSequence } from '../model/graph/physical-entity/entity-with-accessioned-sequence.model';
import { LiteratureReference } from '../model/graph/publication/literature-reference.model';
import { SchemaClasses } from '../constants/constants';
import { CatalystActivity } from '../model/graph/catalyst-activity.model';
import { Regulation } from '../model/graph/Regulation/regulation.model';
import type { Relationship } from '../model/graph/relationship.model';
import { ReferenceGroup } from '../model/graph/reference-entity/reference-group.model';
import { ReplacedResidue } from '../model/graph/abstract-modified-residue/replaced-residue.model';
import { FragmentModification } from '../model/graph/abstract-modified-residue/fragment-modification.model';
import { ReferenceMolecule } from '../model/graph/reference-entity/reference-molecule.model';
import { Publication } from '../model/graph/publication/publication.model';
import { Book } from '../model/graph/publication/book.model';
import { ReferenceEntity } from '../model/graph/reference-entity/reference-entity.model';
import type { Molecule } from '../model/participant.model';
import { SimpleEntity } from '../model/graph/physical-entity/simple-entity.model';
import { SummaryEntity } from '../model/graph/physical-entity/summary-entity.model';
import { ReferenceSequence } from '../model/graph/reference-entity/reference-sequence.model';
import { ReferenceGeneProduct } from '../model/graph/reference-entity/reference-gene-product.model';
import { WritableSignal } from '@angular/core';
type HasModifiedResidue = Relationship.HasModifiedResidue;

export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

export function isDefinedAndNotEmpty<T>(value: T[] | undefined | null): value is T[] {
  return value !== undefined && value !== null && value.length > 0;
}

export function groupAndSortBy<E, K>(
  elements: E[],
  getKey: (element: E) => K,
  orderBy: (key1: K, key2: K) => number
): {
  key: K;
  elements: E[];
}[] {
  const grouped = new Map<K, E[]>();
  elements.forEach((element) =>
    grouped.set(getKey(element), [...(grouped.get(getKey(element)) || []), element])
  );
  return [...grouped.keys()].sort(orderBy).map((key) => ({ key, elements: grouped.get(key)! }));
}

export function sortByYearDescending(refs: Publication[]) {
  // Filter refs (i.e., LiteratureReference or Book)
  const withYear = refs.filter(isRefOrBook);

  withYear.sort((a, b) => {
    if (a.year && b.year) return 0;
    if (a.year) return 1;
    if (b.year) return -1;
    return b.year - a.year;
  });

  // Return the sorted items along with the others (without year) at the end
  const withoutYear = refs.filter((ref) => !isRefOrBook(ref));
  return [...withYear, ...withoutYear];
}

// Type guards to narrow the type
/**
 * Anything told apart by its class: a graph object, or a view the pathway
 * browser builds of one (a molecule, a molecular process). The guards below
 * read nothing else.
 */
export type Classed = { schemaClass: string };

export function isEvent(obj: Classed): obj is Event {
  return isExactlyPathway(obj) || isExactlyTLP(obj) || isExactlyCellLineagePath(obj) || isRLE(obj);
}

export function isExactlyPathway(obj: Classed): obj is Pathway {
  return obj.schemaClass === SchemaClasses.PATHWAY;
}

export function isExactlyTLP(obj: Classed): obj is TopLevelPathway {
  return obj.schemaClass === SchemaClasses.TLP;
}

export function isExactlyCellLineagePath(obj: Classed): obj is CellLineagePath {
  return obj.schemaClass === SchemaClasses.CELL_LINEAGE_PATH;
}

export function isPathway(obj: Classed): obj is Pathway | TopLevelPathway | CellLineagePath {
  return isExactlyPathway(obj) || isExactlyTLP(obj) || isExactlyCellLineagePath(obj);
}

const physicalEntityClasses: Set<string> = new Set([
  SchemaClasses.PE,
  SchemaClasses.COMPLEX,
  SchemaClasses.DRUG,
  SchemaClasses.CHEMICAL_DRUG,
  SchemaClasses.PROTEIN_DRUG,
  SchemaClasses.RNA_DRUG,
  SchemaClasses.ENTITY_SET,
  SchemaClasses.DEFINED_SET,
  SchemaClasses.CANDIDATE_SET,
  SchemaClasses.GENOME_ENCODED_ENTITY,
  SchemaClasses.EWAS,
  SchemaClasses.OTHER_ENTITY,
  SchemaClasses.POLYMER,
  SchemaClasses.SIMPLE_ENTITY,
  SchemaClasses.CELL,
  SchemaClasses.SUMMARY_ENTITY,
]);

export function isPhysicalEntity(obj: Classed): obj is PhysicalEntity {
  return physicalEntityClasses.has(obj.schemaClass);
}

export function isReferenceSummary(obj: object): obj is SummaryEntity {
  return 'summarisedEntities' in obj && obj.summarisedEntities !== undefined;
}

const ReferenceEntityClasses: Set<string> = new Set([
  SchemaClasses.REFERENCE_ENTITY,
  SchemaClasses.REFERENCE_GROUP,
  SchemaClasses.REFERENCE_MOLECULE,
  SchemaClasses.REFERENCE_SEQUENCE,
  SchemaClasses.REFERENCE_DNA_SEQUENCE,
  SchemaClasses.REFERENCE_GENE_PRODUCT,
  SchemaClasses.REFERENCE_ISOFORM,
  SchemaClasses.REFERENCE_RNA_SEQUENCE,
  SchemaClasses.REFERENCE_THERAPEUTIC,
  SchemaClasses.SUMMARY_ENTITY,
]);

export function isRefEntity(obj: Classed): obj is ReferenceEntity {
  return ReferenceEntityClasses.has(obj.schemaClass);
}

export function isReferenceEntityStId(id: string | undefined | null): boolean {
  return id?.includes(':') || false;
}
export function isEWAS(obj: Classed): obj is EntityWithAccessionedSequence {
  return obj.schemaClass === SchemaClasses.EWAS;
}

export function isChemical(obj: Classed): obj is SimpleEntity {
  return obj.schemaClass === SchemaClasses.SIMPLE_ENTITY;
}

const reactionLikeEventClasses: Set<string> = new Set([
  SchemaClasses.REACTION,
  SchemaClasses.BLACK_BOX_EVENT,
  SchemaClasses.POLYMERISATION,
  SchemaClasses.DEPOLYMERISATION,
  SchemaClasses.FAILED_REACTION,
  SchemaClasses.CELL_DEVELOPMENT_STEP,
]);

export function isRLE(obj: Classed): obj is ReactionLikeEvent {
  return reactionLikeEventClasses.has(obj.schemaClass);
}

// todo: simplify ? introduce relationship?
// All molecules at Molecules tab
const moleculeClasses: Set<string> = new Set([
  SchemaClasses.EWAS,
  SchemaClasses.REFERENCE_GENE_PRODUCT,
  SchemaClasses.REFERENCE_ISOFORM,
  SchemaClasses.REFERENCE_RNA_SEQUENCE,
  SchemaClasses.REFERENCE_DNA_SEQUENCE,
  SchemaClasses.SIMPLE_ENTITY,
  SchemaClasses.REFERENCE_MOLECULE,
  SchemaClasses.REFERENCE_THERAPEUTIC,
]);

/**
 * A molecule, as the molecules view holds one: in that view the object tree's
 * nodes are the participant service's molecules (with their url, identifier
 * and formatted name), told apart by class like the graph objects they stand for.
 */
export function isMolecule<T extends { schemaClass: string }>(obj: T): obj is T & Molecule {
  return moleculeClasses.has(obj.schemaClass);
}

export function isPathwayWithDiagram(obj: DatabaseObject): obj is Pathway {
  return isPathway(obj) && obj.hasDiagram === true;
}

const regulationClasses: Set<string> = new Set([
  SchemaClasses.REGULATION,
  SchemaClasses.NEGATIVE_REGULATION,
  SchemaClasses.NEGATIVE_GENE_EXPRESSION_REGULATION,
  SchemaClasses.POSITIVE_REGULATION,
  SchemaClasses.POSITIVE_GENE_EXPRESSION_REGULATION,
  SchemaClasses.REQUIREMENT,
]);

export function isRegulation(
  obj: Regulation | CatalystActivity | HasModifiedResidue
): obj is Regulation {
  return 'schemaClass' in obj && regulationClasses.has(obj.schemaClass);
}

export function isCatalystActivity(
  obj: Regulation | CatalystActivity | HasModifiedResidue
): obj is CatalystActivity {
  return 'schemaClass' in obj && obj.schemaClass === SchemaClasses.CATALYST_ACTIVITY;
}

export function isHasModifiedResidue(
  obj: Regulation | CatalystActivity | HasModifiedResidue
): obj is HasModifiedResidue {
  // Of the three, only the modified-residue entry has a type.
  return 'type' in obj;
}

const fragmentModificationClasses: Set<string> = new Set([
  SchemaClasses.FRAGMENT_MODIFICATION,
  SchemaClasses.FRAGMENT_DELETION_MODIFICATION,
  SchemaClasses.FRAGMENT_INSERTION_MODIFICATION,
  SchemaClasses.FRAGMENT_REPLACED_MODIFICATION,
]);

export function isFragmentModification(obj: Classed): obj is FragmentModification {
  return fragmentModificationClasses.has(obj.schemaClass);
}

export function isReplacedResidue(obj: Classed): obj is ReplacedResidue {
  return (
    obj.schemaClass === SchemaClasses.REPLACED_RESIDUE ||
    obj.schemaClass === SchemaClasses.NONSENSE_MUTATION
  );
}

export function isReferenceGroup(obj: Classed): obj is ReferenceGroup {
  return obj.schemaClass === SchemaClasses.REFERENCE_GROUP;
}

export function isReferenceMolecule(obj: Classed): obj is ReferenceMolecule {
  return obj.schemaClass === SchemaClasses.REFERENCE_MOLECULE;
}

const referenceSequenceClasses: Set<string> = new Set([
  SchemaClasses.REFERENCE_SEQUENCE,
  SchemaClasses.REFERENCE_DNA_SEQUENCE,
  SchemaClasses.REFERENCE_DNA_SEQUENCE,
  SchemaClasses.REFERENCE_GENE_PRODUCT,
  SchemaClasses.REFERENCE_ISOFORM,
]);

export function isReferenceSequence(
  obj: DatabaseObject | ReferenceEntity
): obj is ReferenceSequence {
  return referenceSequenceClasses.has(obj.schemaClass);
}

const referenceGeneProductClasses: Set<string> = new Set([
  SchemaClasses.REFERENCE_GENE_PRODUCT,
  SchemaClasses.REFERENCE_ISOFORM,
]);

export function isReferenceGeneProduct(obj: Classed): obj is ReferenceGeneProduct {
  return referenceGeneProductClasses.has(obj.schemaClass);
}

export function isRefOrBook(publication: Publication): publication is LiteratureReference | Book {
  return (
    publication.schemaClass === SchemaClasses.LITERATURE_REFERENCE ||
    publication.schemaClass === SchemaClasses.BOOK
  );
}

export function isSelectableObject(obj: Classed): obj is Event | PhysicalEntity {
  return isEvent(obj) || isPhysicalEntity(obj);
}

/** Generic function to dynamic access child property
 *  T represents the type of the obj parameter, which must extend DatabaseObject.
 *  K is constrained to the keys of T, ensuring only valid keys of the given object type can be accessed.
 *  The function uses key in obj to check if the property exists on the object at runtime.
 *  If it does, it returns the value of the property. Otherwise, it returns undefined.
 */

/**
 * A field read by a name known only at run time (a tab's configured key):
 * whatever the object holds there, unknown until the reader checks it.
 */
export function fieldByName(obj: object, key: string): unknown {
  return key in obj ? Reflect.get(obj, key) : undefined;
}

/**
 * A relationship entry (it has an element), as against a graph object, which
 * never has one: how the trees tell the two apart in what they are given.
 */
export const isEntry = <E extends object, R extends object>(value: E | R): value is R =>
  'element' in value;

/** A field of an object, if it is one, read as text; undefined for anything else. */
export function textField(from: unknown, key: string): string | undefined {
  const value = typeof from === 'object' && from !== null ? fieldByName(from, key) : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** A key any member of a union has: `inferredTo` on an event, which an entity also has. */
type KeyOfAny<T> = T extends unknown ? keyof T : never;

/** What the members of a union that have a key hold there; none, for the others. */
type ValueOfAny<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : undefined
  : never;

/**
 * A field of whichever member of a union `obj` is, or undefined when it has
 * none (a selected object may be an event or an entity). The `in` check is
 * the boundary: the member that has the key holds that member's value there.
 */
export function getProperty<T extends object, K extends KeyOfAny<T>>(
  obj: T,
  key: K
): ValueOfAny<T, K> | undefined {
  return key in obj ? (obj as Record<K, ValueOfAny<T, K>>)[key] : undefined;
}

/**
 * If any value among the representative sample has an exponent part above +3 or bellow -3, then it should be scientificFormat.
 *
 * @param representativeSample e.g. [firstValue, lastValue, min, max]
 */
export const shouldBeScientificFormat = (representativeSample: number[]) =>
  representativeSample.some(shouldBeScientificFormatValue);

/**
 * if value has an exponent part above +3 or bellow -3, then it should be scientificFormat
 * @param value a number
 */
const shouldBeScientificFormatValue = (value: number) =>
  parseInt(value.toExponential(0).split(/e[+-]/)[1] ?? '0') > 3;

export type ArrayStats = {
  min: number;
  max: number;
  average: number;
  sum: number;
  multiValued?: boolean;
};

export function getArrayStats(values: number[]): ArrayStats {
  if (values.length === 0) return { min: 0, max: 0, average: 0, sum: 0, multiValued: false };
  const summary: ArrayStats = values.reduce(
    (acc: ArrayStats, value) => {
      if (value < acc.min) acc.min = value;
      if (value > acc.max) acc.max = value;
      acc.sum += value;
      return acc;
    },
    { min: Number.MAX_VALUE, max: Number.MIN_VALUE, sum: 0, average: 0 }
  );
  summary.average = summary.sum / values.length;
  summary.multiValued = values.length > 1;
  return summary;
}

/**
 * J01866EMBL:J01866 5.8S rRNA ➡️ J01866
 * ENSG00000001630ENSEMBL:ENSG00000001630 CYP51A1 ➡️ ENSG00000001630
 * UniProt:A0A183 LCE6A ➡️ A0A183
 * @param value
 */
export function extractIdAfterColon(value: string): string {
  if (!value) return '';

  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) return '';

  const afterColon = value.substring(colonIndex + 1).trim();
  const spaceIndex = afterColon.indexOf(' ');

  return spaceIndex !== -1 ? afterColon.substring(0, spaceIndex) : afterColon;
}

/**
 * ripasudil  [Guide to Pharmacology:10423] ➡️ 10423
 * rosiglitazone [Guide to Pharmacology:1056] ➡️ 1056
 * @param value
 */
export function extractIdInBrackets(value: string): string {
  const match = value.match(/\[.*?:([^\]\s]+)\]/);
  return match?.[1] ?? '';
}

/**
 * A molecule's name from its display name, which carries its database and
 * identifier as well: in front for proteins, DNA and RNA
 * ("UniProt:P78396 CCNA1", "EMBL:X59360 U2 snRNA"), behind for chemicals and
 * drugs ("carbon dioxide [ChEBI:16526]", "panobinostat [Guide to Pharmacology -
 * Ligands:7489]").
 *
 * The name itself may hold spaces. Cutting at a space, as the molecule tab did,
 * showed "carbon" for carbon dioxide, "snRNA" for U2 snRNA and
 * "1D-myo-inositol" for 1D-myo-inositol 1,4,5,6-tetrakisphosphate(8-).
 */
export function nameAfterIdentifier(displayName: string): string {
  if (!displayName) return '';
  const trimmed = displayName.trim();
  // The database's name may hold spaces ("NCBI Nucleotide:MN908947.3 ..."),
  // the identifier does not.
  const match = /^[^:]+:\S+\s+(.+)$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** See {@link nameAfterIdentifier}: the name before a trailing "[database:identifier]". */
export function nameBeforeIdentifier(displayName: string): string {
  if (!displayName) return '';
  const trimmed = displayName.trim();
  const name = trimmed.replace(/\s*\[[^[\]]*:[^[\]]*\]$/, '');
  return name || trimmed;
}

export function average(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

// ideas => https://levelup.gitconnected.com/building-a-html-table-of-contents-with-automatic-highlighting-7bf51ec4c972
export function observeSections(
  elementIds: string[],
  selectedKey: WritableSignal<string>,
  manualSelection: boolean,
  includeDownload: boolean
) {
  const observer = new IntersectionObserver((entries) => {
    if (manualSelection) return;
    // filtering visible elements
    const visibles = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

    const [topmost] = visibles;
    if (topmost) {
      const id = topmost.target.id;
      if (id && id !== selectedKey()) {
        selectedKey.set(id);
      }
    }
  });

  queueMicrotask(() => {
    elementIds.forEach((id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });

    if (includeDownload) {
      const downloadSection = document.getElementById('download');
      if (downloadSection) {
        observer.observe(downloadSection);
      }
    }
  });
  // return cleanup function
  return () => observer.disconnect();
}

/**
 * The first of an object's names. A reference summary often has none (13 of 15
 * sampled), though its type inherits a required list from PhysicalEntity.
 */
export function firstName(obj: { name?: unknown }): string | undefined {
  const names = obj.name as string[] | string | undefined;
  return Array.isArray(names) ? names[0] : names;
}
