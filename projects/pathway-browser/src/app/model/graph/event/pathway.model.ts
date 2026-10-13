import { Event } from './event.model';
import type { Relationship } from '../relationship.model';
type HasEvent = Relationship.HasEvent;

export interface Pathway extends Event {
  /**
   * Its child events: sent by /data/query/enhanced, but not by
   * /data/event/{id}/ancestors, whose pathways seed the hierarchy (#344). The
   * tree copies them across from a fetched pathway, which may have none.
   */
  events?: HasEvent[] | undefined;
  hasDiagram: boolean;
  hasEHLD: boolean;
  normalPathway?: Pathway;
  diseasePathways?: Pathway[];
  orthologousEvent?: Event[];

  //not from API endpoint but are needed in the tree view; cleared to undefined
  subpathwayColor?: string | undefined;
  hitReactionsCount?: string | undefined;
}
