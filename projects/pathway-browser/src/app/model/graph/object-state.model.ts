import type { Event } from './event/event.model';

/**
 * What the pathway browser adds to an object it holds, in its trees and tabs,
 * and never sends: its loading, its place in the event tree, a search hit, a
 * composition entry's position. Every field optional, and named, where the
 * objects used to take any field at all (`[key: string]: any`).
 */
export interface ObjectState {
  isLoaded?: boolean;
  _updateCounter?: number;
  /** The event tree's selection and hover. */
  isSelected?: boolean;
  isHovered?: boolean;
  /** An analysis or search hit, in the event tree. */
  hit?: boolean;
  /** Set once the lineage is known; no answer carries it. */
  ancestors?: Event[];
  /** None for a top-level event. */
  parent?: Event | undefined;
  /** A pathway's colour and hit count in the tree; cleared to undefined. */
  subpathwayColor?: string | undefined;
  hitReactionsCount?: string | undefined;
  /** A composition entry's position, and how the molecules tab shows it. */
  index?: number;
  moleculeView?: boolean;
  highlight?: boolean;
}
