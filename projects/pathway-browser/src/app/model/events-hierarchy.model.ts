import type { EventsHierarchyNode } from '../../../../contract/events-hierarchy.ts';

export namespace EventsHierarchy {
  /** The answer's node, as the contract describes it. */
  export type Data = EventsHierarchyNode;

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
