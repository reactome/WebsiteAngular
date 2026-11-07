// The graph's objects as the content service writes them (spec 016, T025;
// research R9): Java's classes, under their own names, each generic in how a
// related object already written is referred to again.
//
// `Ref` is `JsogReference` where the answer is JSOG (`/data/query/enhanced/v2/{id}`,
// asked with `includeRef=true`) and `number`, the object's dbId, elsewhere. A
// related object is `X<Ref> | Ref`. The fields of each class are the domain
// snapshot's, both ways (graph.spec.ts); which are required is measured on the
// recorded answers, as each comment says. The pathway browser reads these
// through `Resolved<>`, which replaces every reference with its object.
//
// T025b: the edits, their authors and the authors' publications, affiliations
// and cross-references. The other classes follow, family by family (T025c-f).

/** A later appearance of an object already written whole in the same JSOG answer. */
export interface JsogReference {
  /** The `@id` the object was written with. */
  '@ref': string;
}

/** How an answer refers to an object it has written already: JSOG's reference, or the dbId. */
type Ref = JsogReference | number;

/** What every class writes. */
interface DatabaseObjectFields {
  /** The object's number in a JSOG answer, on its first appearance; absent elsewhere. */
  '@id'?: string;
  dbId: number;
  displayName: string;
  stId?: string;
  stIdVersion?: string;
  /** The class as Java names it to people (`Set` for a DefinedSet); `schemaClass` is the class. */
  className: string;
}

/** The edits that created and last changed an object, on the classes that write them. */
interface Edited<R extends Ref> {
  created?: InstanceEdit<R> | R;
  modified?: InstanceEdit<R> | R;
}

/**
 * A curation edit: who made it and when. Measured over 4,172 in the enhanced
 * query's recordings (26 elsewhere): the date always, the note on 873; the
 * authors in every enhanced answer, left out of the flat view.
 */
export interface InstanceEdit<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'InstanceEdit';
  dateTime: string;
  note?: string;
  author?: (Person<R> | R)[];
}

/**
 * A person, as an edit's or a publication's author and as `/data/person/{id}`
 * answers. Measured over 202,064 in the enhanced query's recordings and 11
 * people's answers: surname and initial always; a first name on 165,415, an
 * ORCID on 2,817, a project on 2,511.
 */
export interface Person<R extends Ref> extends DatabaseObjectFields {
  schemaClass: 'Person';
  firstname?: string;
  initial: string;
  surname: string;
  orcidId?: string;
  project?: string;
  affiliation?: (Affiliation<R> | R)[];
  /** Never recorded. */
  crossReference?: (DatabaseIdentifier<R> | R)[];
  publications?: (Publication<R> | R)[];
}

/** A person's institution. Recorded only in people's answers (8, each with an address). */
export interface Affiliation<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'Affiliation';
  address?: string;
  name: string[];
}

/** What every publication writes. */
interface PublicationFields<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  title: string;
  /** In every enhanced answer; left out of the flat view. */
  author?: (Person<R> | R)[];
}

/**
 * A journal article. Measured over 33,014 in the enhanced query's recordings
 * and 231 elsewhere: the PubMed id, year and link always; a journal on all
 * but 31, pages on all but 920, a volume on all but 215.
 */
export interface LiteratureReference<R extends Ref> extends PublicationFields<R> {
  schemaClass: 'LiteratureReference';
  journal?: string;
  pages?: string;
  pubMedIdentifier: number;
  volume?: number;
  year: number;
  url: string;
}

/** A book or a chapter. Measured over 243: the year always; an ISBN on 202, a chapter title on 154, pages on 135. */
export interface Book<R extends Ref> extends PublicationFields<R> {
  schemaClass: 'Book';
  chapterTitle?: string;
  pages?: string;
  year: number;
  /** Never recorded. */
  publisher?: Affiliation<R> | R;
  isbn?: string;
}

/** A web page. Measured over 61: the address always. */
interface URL<R extends Ref> extends PublicationFields<R> {
  schemaClass: 'URL';
  uniformResourceLocator: string;
}

/** @discriminator schemaClass */
export type Publication<R extends Ref> = LiteratureReference<R> | Book<R> | URL<R>;

/**
 * An identifier in another database. Measured over 5,682 in the enhanced
 * query's recordings and 87 elsewhere: the database's name, the identifier
 * and its link always; never its own cross-references or the database's object.
 */
export interface DatabaseIdentifier<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'DatabaseIdentifier';
  databaseName: string;
  identifier: string;
  url: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  referenceDatabase?: ReferenceDatabase<R> | R;
}

/** A database Reactome links to. Measured over 4, each with every field. */
export interface ReferenceDatabase<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'ReferenceDatabase';
  accessUrl: string;
  name: string[];
  url: string;
  resourceIdentifier: string;
  identifiersPrefix: string;
}

// T025c: what the graph's events and entities are annotated with: species and
// taxa, compartments and GO terms, the external ontologies, summations,
// figures and review status. Closed under their relations: none leads to an
// event or an entity.

/** A taxon, or a species, which is one. */
interface Taxon<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'Taxon';
  /** Never recorded as a class of its own: as the snapshot writes it, each field may be left out. */
  name?: string[];
  taxId?: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  superTaxon?: AnyTaxon<R> | R;
}

/**
 * A species. Measured over 11,134 in the enhanced query's recordings and
 * 8,580 elsewhere: its names, taxon id and abbreviation always; a
 * cross-reference on 1,007; never its super-taxon.
 */
export interface Species<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'Species';
  name: string[];
  taxId: string;
  abbreviation: string;
  crossReference?: (DatabaseIdentifier<R> | R)[];
  superTaxon?: AnyTaxon<R> | R;
}

/** A taxon or a species: what a super-taxon is. @discriminator schemaClass */
export type AnyTaxon<R extends Ref> = Taxon<R> | Species<R>;

/** What every GO term writes. */
interface GoTermFields<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  accession: string;
  databaseName: string;
  definition: string;
  name: string;
  url: string;
  /** Never recorded. */
  referenceDatabase?: ReferenceDatabase<R> | R;
}

/** What a cellular component, and so a compartment, writes besides a GO term's: never recorded, each may be left out. */
interface CellularComponentFields<R extends Ref> extends GoTermFields<R> {
  componentOf?: (AnyGO_CellularComponent<R> | R)[];
  hasPart?: (AnyGO_CellularComponent<R> | R)[];
  instanceOf?: (AnyGO_CellularComponent<R> | R)[];
  surroundedBy?: (AnyGO_CellularComponent<R> | R)[];
}

/**
 * GO terms. Measured over 3,282 biological processes, 1,767 compartments,
 * 57 molecular functions and 2 cellular components: accession, database,
 * definition, name and link always; an EC number on 30 molecular functions.
 */
export interface GO_BiologicalProcess<R extends Ref> extends GoTermFields<R> {
  schemaClass: 'GO_BiologicalProcess';
}

export interface GO_MolecularFunction<R extends Ref> extends GoTermFields<R> {
  schemaClass: 'GO_MolecularFunction';
  ecNumber?: string;
}

interface GO_CellularComponent<R extends Ref> extends CellularComponentFields<R> {
  schemaClass: 'GO_CellularComponent';
}

/** A cellular component a physical entity is in. */
export interface Compartment<R extends Ref> extends CellularComponentFields<R> {
  schemaClass: 'Compartment';
}

/** A cellular component or a compartment. @discriminator schemaClass */
type AnyGO_CellularComponent<R extends Ref> = GO_CellularComponent<R> | Compartment<R>;

/**
 * What every term of an external ontology writes. Measured over 77 diseases,
 * 22 evidence types and 1 PSI-MOD term: a disease's database, identifier,
 * names and link always, its definition on all but 2, synonyms on 61; an
 * evidence type has only its names. Anatomy, cell types and Sequence
 * Ontology terms are never recorded, so for them each field may be left out.
 */
interface ExternalOntologyFields<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  databaseName?: string;
  definition?: string;
  identifier?: string;
  name?: string[];
  synonym?: string[];
  url?: string;
  /** Never recorded. */
  instanceOf?: (ExternalOntology<R> | R)[];
  /** Never recorded. */
  referenceDatabase?: ReferenceDatabase<R> | R;
}

export interface Anatomy<R extends Ref> extends ExternalOntologyFields<R> {
  schemaClass: 'Anatomy';
}

export interface CellType<R extends Ref> extends ExternalOntologyFields<R> {
  schemaClass: 'CellType';
}

export interface Disease<R extends Ref> extends ExternalOntologyFields<R> {
  schemaClass: 'Disease';
  databaseName: string;
  identifier: string;
  name: string[];
  url: string;
}

interface EvidenceType<R extends Ref> extends ExternalOntologyFields<R> {
  schemaClass: 'EvidenceType';
  name: string[];
}

/** A PSI-MOD term, as a modification names it. Recorded once, with every field. */
export interface PsiMod<R extends Ref> extends ExternalOntologyFields<R> {
  schemaClass: 'PsiMod';
  databaseName: string;
  definition: string;
  identifier: string;
  name: string[];
  url: string;
  label: string;
}

interface SequenceOntology<R extends Ref> extends ExternalOntologyFields<R> {
  schemaClass: 'SequenceOntology';
}

/** @discriminator schemaClass */
type ExternalOntology<R extends Ref> =
  Anatomy<R> | CellType<R> | Disease<R> | EvidenceType<R> | PsiMod<R> | SequenceOntology<R>;

/** An event's or an entity's description. Measured over 914: the text always. */
export interface Summation<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'Summation';
  text: string;
  /** In every enhanced answer; left out of the flat view. */
  literatureReference?: (Publication<R> | R)[];
}

/** An illustration. Measured over 668: its link always. */
export interface Figure<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'Figure';
  url: string;
}

/** How far an event's curation has been reviewed. Measured over 1,100: its definition and names always. */
export interface ReviewStatus<R extends Ref> extends DatabaseObjectFields, Edited<R> {
  schemaClass: 'ReviewStatus';
  definition: string;
  name: string[];
}
