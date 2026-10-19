import type { Analysis } from './analysis.model';

export namespace EventsHierarchy {
  export interface Data {
    diagram: boolean;
    name: string;
    stId: string;
    type: 'TopLevelPathway' | 'Pathway' | 'CellLineagePath';
    species: string;
    llp?: boolean;
    totalEntity: number;
    totalEntityAndInteractors: number;
    /** Left out on a pathway with no sub-pathways (2,143 of 3,018 human ones). */
    children?: Data[];
    reactions?: Analysis.Pathway['reactions'];
    /**
     * The analysis's figures, as the AnalysisService gives them, except that
     * `exp` is left out when empty: the content service omits empty lists, so
     * a pathway in an analysis without expression values has none (recorded
     * eventsHierarchy answers with a token: every node of an overrepresentation
     * analysis).
     */
    entities?: Omit<Analysis.Pathway['entities'], 'exp'> & { exp?: number[] };
  }

  /** One left undefined is not sent: there may be no analysis to colour by. */
  export interface QueryParams {
    pathwaysOnly?: boolean;
    token?: string | undefined;
    resource?: string | undefined;
    interactors?: boolean | undefined;
    importableOnly?: boolean;
    view?: 'flatten' | 'nested' | 'nested-aggregated';
  }
}
