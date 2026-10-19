// Shape returned by /interactors/static/molecule/{acc}/withEntities --
// each row is one interactor partner with its Reactome PhysicalEntities
// pre-joined (no client-side fan-out to /references/mapping/{id}/xrefs).
export interface InteractionWithEntities {
  score: number;
  accession: string;
  accessionURL: string;
  // Never empty: the endpoint returns only the interactors that have entities.
  physicalEntity: { dbId: number; stId: string; displayName: string; schemaClass: string }[];
  evidences: number;
  url: string;
}
