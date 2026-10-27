// The content service's interactors (spec 016, T023): an entity's interactors as the
// pathway browser draws them, the enhanced interactions of the interactor tables, the
// PSICQUIC services, and an interaction with the Reactome entities its partner is.
//
// Interactors come from four places: Reactome's own (static), DisGeNET, PSICQUIC
// registries and custom uploads. Measured from the static set (388 interactors of four
// entities, #344); the others are not served where they can be measured, so a field
// only the static set always sends stays optional.

export interface InteractorEntity {
  acc: string;
  count: number;
  /** Left out when there are none. */
  interactors?: Interactor[] | null;
}

export interface Interactor {
  acc: string;
  accURL: string;
  /** Left out for some (5 of 388 static). */
  alias?: string;
  evidences: number;
  evidencesURL: string;
  id: number;
  score?: number;
  /** Not sent by the static set at all. */
  type?: string;
}

/**
 * One interaction of /interactors/static/molecule/enhanced/{id}/details, with more
 * about the partner. The identifier, URLs, database and display name are written as
 * the text "null" when the graph has none, as Java writes them.
 */
export interface CustomInteraction {
  dbId: number;
  identifier: string;
  score: number;
  evidenceCount: number;
  /** The partner's own page; the text "null" when the graph has none, as Java writes it. */
  url: string;
  evidenceURL: string;
  geneName?: string[];
  databaseName: string;
  entitiesCount: number;
  speciesName: string;
  displayName: string;
  /** An isoform's or a chain's own identifier, such as Q99IB8-PRO_0000045603. */
  variantIdentifier?: string;
}

/**
 * A PSICQUIC service as /interactors/psicquic/resources writes it: a URL the
 * registry does not give is left out (non_empty), so either may be absent.
 */
export interface PsicquicResource {
  name: string;
  soapURL?: string;
  restURL?: string;
  active: boolean;
}

/**
 * One interaction of /interactors/static/molecule/{id}/withEntities: the partner with
 * its Reactome physical entities joined in.
 */
export interface InteractionWithEntities {
  score: number;
  accession: string;
  accessionURL: string;
  /** Never empty: the endpoint returns only the interactors that have entities. */
  physicalEntity: { dbId: number; stId: string; displayName: string; schemaClass: string }[];
  evidences: number;
  url: string;
}
