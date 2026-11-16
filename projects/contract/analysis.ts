// The analysis service's answers (spec 016, T027): an analysis's result, its
// pathways, the identifiers it found in one and those it found nowhere. The
// AnalysisService (Java, kept: analysis maths is not ported) writes them; the
// pathway browser reads them, and tools/analysis-types compiles every recorded
// answer as the type it is read as. Measured from the end-to-end recordings and
// tools/analysis-types/recorded.

/** A resource an identifier can be mapped from, and a result summarised by. */
export type AnalysisResource =
  | 'TOTAL'
  | 'UNIPROT'
  | 'ENSEMBL'
  | 'CHEBI'
  | 'IUPHAR'
  | 'MIRBASE'
  | 'NCBI_PROTEIN'
  | 'EMBL'
  | 'COMPOUND'
  | 'PUBCHEM_COMPOUND';

/**
 * Every analysis type the service can return: its own enum,
 * `AnalysisSummary.type` in its description. The pathway browser keeps the
 * list as data too (`ANALYSIS_TYPES`), checked against this union, so a test
 * can walk it.
 */
export type AnalysisType =
  | 'OVERREPRESENTATION'
  | 'EXPRESSION'
  | 'GSA_REGULATION'
  | 'GSA_STATISTICS'
  | 'GSVA'
  | 'SPECIES_COMPARISON';

/** A pathway of a result: what the analysis found in it, by entities and by reactions. */
export interface AnalysisPathway {
  dbId: number;
  stId: string;
  name: string;
  /**
   * Lower Level Pathway
   */
  llp: boolean;
  inDisease: boolean;
  entities: {
    resource: AnalysisResource;
    total: number;
    found: number;
    ratio: number;
    pValue: number;
    fdr: number;
    exp: number[];
    curatedFound?: number;
    curatedTotal?: number;
    interactorsFound?: number;
    interactorsTotal?: number;
  };
  reactions: {
    resource: AnalysisResource;
    total: number;
    found: number;
    ratio: number;
  };
  species: {
    dbId: number;
    taxId: string;
    name: string;
  };
}

/** An analysis's result: its summary, and a page of its pathways. */
export interface AnalysisResult {
  /** An overrepresentation analysis has no values: no min or max, no columns. */
  expression: {
    columnNames: string[];
    min?: number;
    max?: number;
  };
  identifiersNotFound: number;
  pathwaysFound: number;
  warnings?: string[];
  pathways: AnalysisPathway[];

  resourceSummary: {
    resource: AnalysisResource;
    pathways: number;
    filtered: number;
  }[];

  speciesSummary: {
    dbId: number;
    taxId: string;
    name: string;
    pathways: number;
    filtered: number;
  }[];

  summary: {
    token: string;
    type: AnalysisType | string;
    /** Absent from a species comparison, which has no sample. */
    sampleName?: string;
    text: boolean;
    projection: boolean;
    interactors: boolean;
    includeDisease: boolean;

    species?: number;
    fileName?: string;
    gsaMethod?: string;
    gsaToken?: string;
  };
}

/** Identifiers of one resource. */
interface MappedIdentifiers {
  ids: string[];
  resource: AnalysisResource;
}

/** What an analysis found in one pathway: its entities, and its interactors where it ran with them. */
export interface FoundEntities {
  pathway: string;
  foundEntities: number;
  foundInteractors: number;

  expNames: string[];
  resources: AnalysisResource[];
  entities: FoundEntity[];
  interactors?: {
    id: string;
    interactsWith: MappedIdentifiers;
    mapsTo: string[];
    exp: number[];
  }[];
}

/** An identifier found, and what it maps to. */
interface FoundEntity {
  id: string;
  mapsTo: MappedIdentifiers[];
  exp: number[];
}

/** An identifier the analysis found nowhere, with its values. */
export interface NotFoundIdentifier {
  id: string;
  exp: number[];
}
