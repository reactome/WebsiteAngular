export type { IconCategory, IconFacetResponse } from '../../../contract/search.ts';

// One icon: the contract's (spec 016).
export type { IconEntry } from '../../../contract/search.ts';
import type { IconEntry } from '../../../contract/search.ts';

export interface IconResult {
  /** Left out when nothing matches. */
  entries?: IconEntry[];
  entriesCount: number;
}
