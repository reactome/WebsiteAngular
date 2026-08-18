import { Event } from './event.model';
import type { Relationship } from '../relationship.model';
type HasEvent = Relationship.HasEvent;

export interface Pathway extends Event {
  events: HasEvent[];
  hasDiagram: boolean;
  hasEHLD: boolean;
  normalPathway?: Pathway;
  diseasePathways?: Pathway[];
  orthologousEvent?: Event[];

  //not from API endpoint but are needed in the tree view
  subpathwayColor?: string;
  hitReactionsCount?: string;
}
