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
   * Never sent, as far as anything here can tell.
   *
   * `/data/content/toc` returns `stId`, `displayName` and `speciesName` for a
   * child and nothing else -- measured over 215 nested subpathways, none of
   * which carried a `doi`. `toc.component.html:161` renders a DOI link behind
   * `@if (sub.doi)`, so that markup cannot fire today.
   *
   * Left optional rather than deleted because it is not clear which side is
   * wrong: the endpoint's child projection may be missing a field it should
   * send, or the link may be markup for a case that never existed. Deleting the
   * field would settle that question by forgetting it.
   */
  doi?: string | null;
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
  doi?: string | null;
  species: string;
  releaseDate: string;
  reviseDate?: string;
  releaseStatus?: string | null;
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
  doi: string | null;
  species: string;
  releaseDate: string;
  /**
   * Like the TOC's, omitted when there is none. Measured over the 669 pathways
   * `/data/content/doi` returns: `reviseDate` absent in 564, `releaseStatus` in
   * 608, and the people lists in a few -- `authors` 3, `reviewers` 11,
   * `editors` 12.
   */
  reviseDate?: string;
  releaseStatus?: string | null;
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

export interface SimpleDatabaseObject {
  dbId: number;
  stId: string;
  displayName: string;
  schemaClass: string;
}

export interface InstanceReferrals {
  referral: string;
  objects: SimpleDatabaseObject[];
}
