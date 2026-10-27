// The content service's lists and schema tables (spec 016, T022): the
// contents and DOI pages, the contributors, the schema browser's class tree,
// attributes and instances, and an instance's referrers.

/**
 * The five fields Java's SimplePerson carries -- three of which are not always
 * there.
 *
 * `spring.jackson.default-property-inclusion=non_empty` in the content service
 * means a null or empty field is omitted from the JSON rather than sent as
 * null, so an absent value arrives as `undefined` and never as `null`. Measured
 * over all 9,503 person entries the three content endpoints return: `dbId`,
 * `displayName` and `surname` are always present; `firstname` is missing on 619
 * of them and `orcidId` on 3,961, and neither is ever null.
 *
 * The declaration used to say otherwise, and three separate call sites had
 * already worked around it -- `p.firstname?.toLowerCase()` in the contributors,
 * contents and DOI searches, where `?.` on a required `string` is dead syntax
 * that quietly says the author knew better than the type.
 */
export interface SimplePerson {
  dbId: number;
  displayName: string;
  surname: string;
  firstname?: string;
  orcidId?: string;
}

export interface TocSubpathway {
  stId: string;
  displayName: string;
  /**
   * Sent when the child has a DOI. Java never sends it (its TocSubpathway is
   * built with a null DOI); the node service does, a difference it declares
   * (`differs` on /data/content/toc). In five of the six recorded answers,
   * 107 of the 215 subpathways carry one; the sixth, an older recording,
   * carries none.
   */
  doi?: string;
  speciesName: string;
}

export interface TocPathway {
  stId: string;
  displayName: string;
  /**
   * Omitted rather than sent null when there is none. Measured over the 34
   * top-level pathways `/data/content/toc` returns: `doi` absent in 29,
   * `reviseDate` in 30, `releaseStatus` in 19. Declaring them required let
   * `pathway.doi !== null` read as true for a field that is not there.
   */
  doi?: string;
  species: string;
  releaseDate: string;
  reviseDate?: string;
  releaseStatus?: string;
  /**
   * Present on all 34 today, but the service leaves out an empty list rather
   * than sending [] -- /data/content/doi omits each of the people lists for a
   * few pathways -- so a top-level pathway without reviewers, or without
   * subpathways, would come without the field.
   */
  authors?: SimplePerson[];
  reviewers?: SimplePerson[];
  editors?: SimplePerson[];
  subpathways?: TocSubpathway[];
}

export interface DoiPathway {
  stId: string;
  displayName: string;
  doi: string;
  species: string;
  releaseDate: string;
  /**
   * Like the TOC's, omitted when there is none. Measured over the 669 pathways
   * `/data/content/doi` returns: `reviseDate` absent in 564, `releaseStatus` in
   * 608, and the people lists in a few -- `authors` 3, `reviewers` 11,
   * `editors` 12.
   */
  reviseDate?: string;
  releaseStatus?: string;
  authors?: SimplePerson[];
  reviewers?: SimplePerson[];
  editors?: SimplePerson[];
}

export interface Contributor {
  person: SimplePerson;
  authoredPathways: number;
  reviewedPathways: number;
  authoredReactions: number;
  reviewedReactions: number;
}

export interface SchemaNode {
  className: string;
  count: number;
  /** Left out on a class with no subclasses (74 of the 106). */
  children?: SchemaNode[];
}

export interface SchemaValueType {
  name: string;
  databaseObject: boolean;
}

export interface SchemaAttribute {
  name: string;
  cardinality: string;
  valueTypes: SchemaValueType[];
  origin: string;
}

/**
 * graph-core's SimpleDatabaseObject as the content service writes it: on
 * /schema/{class}/min by simpleObjectJson (tools/content-node/schema-endpoints.ts),
 * on /instance/{id}/referrers by its own mapping (data-query-endpoints.ts).
 * An object of a class without a stable id --
 * an InstanceEdit, a Species -- has no `stId`, and non_empty leaves it
 * out; an empty displayName is left out the same way, and a missing one is
 * written as the text "null". schemaClass is the class the labels name on
 * /schema/{class}/min, always there; on /instance/{id}/referrers it is the
 * object's property, "null" when missing and left out when empty.
 */
export interface SimpleDatabaseObject {
  dbId: number;
  stId?: string;
  displayName?: string;
  schemaClass?: string;
}

export interface InstanceReferrals {
  referral: string;
  objects: SimpleDatabaseObject[];
}
