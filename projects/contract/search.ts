// The search family's answers, as the content service writes them and the
// site reads them (spec 016).
import type { EpochMillis, Highlighted, Long } from './scalars.ts';

// A count Solr gives under an empty or null name is written without one, as
// Java's NON_EMPTY writes it: nothing can be shown or chosen by it.
export interface FacetCount {
  name?: string;
  count: number;
}

/** A count that can be shown and chosen. */
export type NamedFacetCount = FacetCount & { name: string };

// Each list is left out when it is empty: `selected` when nothing is chosen,
// `available` when the query matches nothing.
export interface Facet {
  selected?: FacetCount[];
  available?: FacetCount[];
}

// A facet Solr did not count is left out, as Java leaves it out.
export interface FacetResponse {
  totalNumFount: number;
  speciesFacet?: Facet;
  typeFacet?: Facet;
  keywordFacet?: Facet;
  compartmentFacet?: Facet;
}

// As with the search facets, a count under an empty name is written without one.
export interface IconCategory {
  name?: string;
  count: number;
}

// As with the search facets, an empty list is left out.
export interface IconFacet {
  selected?: IconCategory[];
  available?: IconCategory[];
}

export interface IconFacetResponse {
  totalNumFount: number;
  // Left out when Solr did not count it, as the search facets are.
  iconCategoriesFacet?: IconFacet;
}

// -- The search entry (data-model.md) --------------------------------------
//
// One Solr document as the service writes it (Java's SolrConverter), by
// kind. A field the indexer can leave out, or the converter can, is
// optional, however often the recordings carry it: a value that is null,
// empty text or an empty list is left out, but `false` is written. A field
// a search highlight can supply (`Highlighted`) is read from the highlight
// alone when there is one, so it is left out when the highlight has no
// snippet for it.
//
// The kinds are exported as their first readers take them (spec 016 T009-
// T011): an export nothing imports is dead code the ratchet counts.

/** What every kind carries. `dbId` is text: Solr stores it as a string field. */
interface EntryBase {
  dbId: string;
  /** The stId, or the dbId when there is none; never highlighted. */
  id: string;
  name?: Highlighted;
  exactType: string;
  /** Only a deleted entry carries it. */
  deleted?: never;
}

/** A pathway or a reaction. A reaction's `exactType` is its category (binding, transition, ...). */
interface EventEntry extends EntryBase {
  type: 'Pathway' | 'Reaction';
  stId: Highlighted;
  species: string[];
  summation?: Highlighted;
  isDisease: boolean;
  /** `isDisease` again: Java's getter. */
  disease: boolean;
  /** Always false: an event has no reference entity. */
  hasReferenceEntity: boolean;
  /** A pathway's. */
  hasEHLD?: boolean;
  compartmentNames?: string[];
  compartmentAccession?: string[];
  /** Only on the species-overview searches. */
  fireworksSpecies?: string[];
}

/**
 * The indexer's types for a physical entity or a reference entity
 * (`getType`, `getReferenceTypes`); any other class goes by its own name.
 * The list of those names is checked against the domain snapshot.
 */
type EntityType =
  | 'Protein'
  | 'DNA Sequence'
  | 'RNA Sequence'
  | 'Chemical Compound'
  | 'Drug'
  | 'Set'
  | 'Genes and Transcripts'
  | EntityClassName;

/**
 * The physical-entity classes the indexer names a type by: those neither a
 * set nor genome-encoded. Every reference-entity class has a type of its
 * own. entity-types.spec.ts derives the list from the domain snapshot.
 */
type EntityClassName =
  | 'Cell'
  | 'ChemicalDrug'
  | 'Complex'
  | 'OtherEntity'
  | 'Polymer'
  | 'ProteinDrug'
  | 'RNADrug'
  | 'SimpleEntity';

/** A physical entity or a reference entity. */
interface EntityEntry extends EntryBase {
  type: EntityType;
  stId: Highlighted;
  /** "Entries without species" when it has none. */
  species: string[];
  summation?: Highlighted;
  isDisease?: boolean;
  disease?: boolean;
  hasReferenceEntity: boolean;
  compartmentNames?: string[];
  compartmentAccession?: string[];
  referenceName?: Highlighted;
  referenceIdentifier?: Highlighted;
  databaseName?: string;
  referenceURL?: string;
  fireworksSpecies?: string[];
}

/** One physical entity an icon draws; an empty part is left out. */
interface IconPhysicalEntity {
  stId?: string;
  type?: string;
  name?: string;
  compartments?: string;
  displayName?: string;
}

/** An icon of the icon library. */
export interface IconEntry extends EntryBase {
  type: 'Icon';
  exactType: 'Icon';
  /** Java's getter: an icon has a name. */
  icon: true;
  stId: Highlighted;
  species?: string[];
  /** The icon's description. Icons have no inferred one to fall back to. */
  summation?: Highlighted;
  iconName?: string;
  iconCategories?: string[];
  iconCuratorName?: string;
  iconCuratorOrcidId?: string;
  iconCuratorUrl?: string;
  iconDesignerName?: string;
  iconDesignerOrcidId?: string;
  iconDesignerUrl?: string;
  iconReferences?: string[];
  iconEhlds?: string[];
  iconPhysicalEntities?: IconPhysicalEntity[];
  /** Always false. */
  hasReferenceEntity: boolean;
  /** Always false. */
  hasEHLD: boolean;
}

/** A person, by name. No stId: `id` is the dbId. The counts are text, as Solr stores them. */
interface PersonEntry extends EntryBase {
  type: 'Person';
  exactType: 'Person';
  /** "Entries without species". */
  species: string[];
  orcidId?: string;
  authoredPathways?: string;
  authoredReactions?: string;
  reviewedPathways?: string;
  reviewedReactions?: string;
}

/** A molecule known only from interaction data; `dbId` and `stId` are its accession. */
interface InteractorEntry extends EntryBase {
  type: 'Interactor';
  exactType: 'Interactor';
  stId: Highlighted;
  species: string[];
  referenceName?: Highlighted;
  referenceIdentifier?: Highlighted;
  databaseName?: string;
  referenceURL?: string;
  fireworksSpecies?: string[];
}

/** An object of an earlier release, deleted since; its type and exactType are those it had. */
interface DeletedEntry extends Omit<EntryBase, 'deleted'> {
  deleted: true;
  type: string;
  stId: Highlighted;
  explanation?: string;
  date?: EpochMillis;
  replacementDbIds?: Long[];
  replacementStIds?: string[];
}

/** One search result. */
type SearchEntry =
  EventEntry | EntityEntry | IconEntry | PersonEntry | InteractorEntry | DeletedEntry;

/** Every field any kind of entry has. */
export type SearchEntryField = SearchEntry extends infer E
  ? E extends unknown
    ? keyof E
    : never
  : never;

/**
 * An entry before it is known which kind it is: every field of any kind,
 * each of the kinds it has in any of them, none required. The service builds
 * this from a Solr document; which kind the document is, is the indexer's.
 */
export type SearchEntryFields = {
  [Field in SearchEntryField]?: SearchEntry extends infer E
    ? E extends unknown
      ? Field extends keyof E
        ? Exclude<E[Field], undefined>
        : never
      : never
    : never;
};

/**
 * Any entry, as a reader that shows every kind reads it: what every kind
 * carries is required, the rest optional with the kinds it has in any of
 * them. A reader that needs one kind narrows on `type` and `deleted`.
 */
export type SearchEntryView = SearchEntryFields &
  Required<Pick<SearchEntryFields, 'dbId' | 'id' | 'type' | 'exactType'>>;

/**
 * What `/search/pathways/of/{dbId}` answers: pathways, written with only the
 * fields the pathway browser asks for (`fields=DB_ID,ST_ID,NAME,HAS_EHLD`), so
 * no type.
 */
export interface PathwayOfEntry {
  dbId: string;
  stId: Highlighted;
  id: string;
  name?: Highlighted;
  hasEHLD?: boolean;
}

// -- The search answers -------------------------------------------------------
//
// Each takes its entry type as an argument: the service writes them with the
// entries it builds, a reader reads them with the view it needs.

/** One group of results: a type's, or "Results" for a search not grouped. */
export interface ResultGroup<Entry> {
  /** Left out when the group has none (an ungrouped search that found none). */
  entries?: Entry[];
  /** Left out for a group Solr names with nothing. */
  typeName?: string;
  /** How many Solr found. */
  entriesCount: number;
  /** How many are written here. */
  rowCount: number;
}

/** A term the search found nothing for, and whether it names a resource; an empty term or resource is left out. */
export interface TargetResult {
  term?: string;
  resource?: string | number | boolean;
  target: boolean;
}

/** `/search/query`: the groups, the rows written, the groups and matches Solr counted. */
export interface GroupedResult<Entry> {
  results: ResultGroup<Entry>[];
  rowCount: number;
  numberOfGroups: number;
  numberOfMatches: number;
  /** For a search that found nothing: the terms, and whether each is a target. */
  targetResults?: TargetResult[];
}

/** `/search/diagram/{id}` and `/search/fireworks`: the entries, their type facets, Solr's count. */
export interface DiagramResult<Entry> {
  /** Left out when there are none. */
  entries?: Entry[];
  /** Left out when there are none. */
  facets?: FacetCount[];
  found: number;
}

/** `/search/icon/query`: the icon library's page, one ungrouped group of icons. */
export type IconResult = ResultGroup<IconEntry>;
