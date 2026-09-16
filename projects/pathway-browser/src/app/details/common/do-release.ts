/**
 * Reading the curation-only `doRelease` attribute of an Event: whether a curator has marked the
 * event to go out in the next Reactome release.
 *
 * Only the curation graph behind GraphContentService sends this attribute. The public content
 * service omits it entirely, and even the curation graph omits it -- rather than sending null --
 * when no curator has set it yet. An absent attribute therefore means two different things
 * depending on which backend answered, which is why the site variant has to be passed in instead
 * of inferred from the payload: on the curator site it means "not marked", and anywhere else it
 * means the backend has nothing to say about releasing and nothing should be rendered.
 *
 * Kept as a plain function so both the header badge and the Overview row read the same rules, and
 * so those rules can be pinned down in tests without standing either component up.
 */

import { DatabaseObject } from '../../model/graph/database-object.model';
import { isEvent } from '../../services/utils';

export interface DoReleaseFlag {
  /** Whether the event is marked to go out in the next release. */
  doRelease: boolean;
  /** Material Symbols glyph name for the badge. */
  icon: string;
  /** Value text for the Overview row. */
  label: string;
  /** Hover text spelling out what the flag means. */
  tooltip: string;
}

const MARKED: DoReleaseFlag = {
  doRelease: true,
  icon: 'check_circle',
  label: 'Marked for release',
  tooltip: 'doRelease is set: this event is marked to go out in the next Reactome release.',
};

const HELD: DoReleaseFlag = {
  doRelease: false,
  icon: 'cancel',
  label: 'Not marked for release',
  tooltip: 'doRelease is not set: this event will be held back from the next Reactome release.',
};

/**
 * How to render the `doRelease` state of `obj`, or undefined when there is nothing to render --
 * either because `obj` is not an Event (only Events carry the attribute) or because a
 * non-curator backend answered and so never sends it.
 */
export function doReleaseFlag(
  obj: DatabaseObject | undefined,
  isCuratorSite: boolean
): DoReleaseFlag | undefined {
  if (!obj || !isEvent(obj)) return undefined;

  const doRelease = obj.doRelease;
  if (doRelease === undefined || doRelease === null) return isCuratorSite ? HELD : undefined;
  return doRelease ? MARKED : HELD;
}
