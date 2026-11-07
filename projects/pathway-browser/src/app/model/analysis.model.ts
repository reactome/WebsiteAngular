import type * as Contract from '../../../../contract/analysis.ts';

/**
 * The analysis service as the pathway browser asks it: how a request sorts and
 * filters, and the names it reads the service's answers by.
 */
export namespace Analysis {
  export type SortBy =
    | 'NAME'
    | 'TOTAL_ENTITIES'
    | 'TOTAL_INTERACTORS'
    | 'TOTAL_REACTIONS'
    | 'FOUND_ENTITIES'
    | 'FOUND_INTERACTORS'
    | 'FOUND_REACTIONS'
    | 'ENTITIES_RATIO'
    | 'ENTITIES_PVALUE'
    | 'ENTITIES_FDR'
    | 'REACTION_RATIO';

  export type Resource = Contract.AnalysisResource;

  export interface Parameters {
    /**
     * Include interactors.
     *
     * Default: false
     */
    interactors?: boolean;
    /**
     * list of species to filter the result (accepts taxonomy ids, species names and dbId).
     *
     * Default: empty
     */
    species?: string;
    /**
     * pathways per page.
     *
     * Default: 20
     */
    pageSize?: number;
    /**
     * page number.
     *
     * Default: 1
     */
    page?: number;
    /**
     * Default: 'ENTITIES_FDR'
     */
    sortBy?: SortBy;
    /**
     * Default: 'ASC'
     */
    order?: 'ASC' | 'DESC';
    /**
     * Default: TOTAL
     */
    resource?: Resource;
    /**
     * defines the pValue threshold. Only hit pathway with pValue equals or below the threshold will be returned.
     *
     * Default: 0.05
     */
    pValue?: number;
    /**
     * set to 'false' to exclude the disease pathways from the result (it does not alter the statistics)
     *
     * Default: true
     */
    includeDisease?: boolean;
    /**
     * minimum number of contained entities per pathway (takes into account the resource)
     *
     * Default: empty
     */
    min?: number;
    /**
     * maximum number of contained entities per pathway (takes into account the resource)
     *
     * Default: empty
     */
    max?: number;
    /**
     * Filters resources to only includes importable ones
     *
     * Default: false
     */
    importableOnly?: boolean;

    /**
     *  All non-human identifiers are converted to their human equivalents. (default = true)
     */
    projectToHuman?: boolean;
  }

  /**
   * Parameters as a request takes them. One left undefined is not sent (see
   * httpParams()), so a caller can pass a filter that may not be set.
   */
  export type RequestParameters = { [K in keyof Parameters]?: Parameters[K] | undefined };

  // The service's answers are the contract's (projects/contract/analysis.ts).
  export type Type = Contract.AnalysisType;
  export type Pathway = Contract.AnalysisPathway;
  export type Result = Contract.AnalysisResult;
  export type FoundEntities = Contract.FoundEntities;
  export type NotFoundIdentifier = Contract.NotFoundIdentifier;
}
