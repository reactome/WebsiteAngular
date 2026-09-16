import { doReleaseFlag } from './do-release';
import { DatabaseObject } from '../../model/graph/database-object.model';

/** The bits of a payload doReleaseFlag actually looks at. */
const instance = (schemaClass: string, doRelease?: boolean | null) =>
  ({ schemaClass, ...(doRelease === undefined ? {} : { doRelease }) }) as unknown as DatabaseObject;

describe('doReleaseFlag', () => {
  it('reports an event the curator marked for release', () => {
    const flag = doReleaseFlag(instance('Pathway', true), true);
    expect(flag?.doRelease).toBe(true);
    expect(flag?.label).toBe('Marked for release');
  });

  it('reports an event the curator marked not to release', () => {
    const flag = doReleaseFlag(instance('Pathway', false), true);
    expect(flag?.doRelease).toBe(false);
    expect(flag?.label).toBe('Not marked for release');
  });

  it('treats an unset attribute on the curator site as not marked', () => {
    // The curation graph omits doRelease rather than sending null when no curator has set it,
    // so absence there still has to render -- as "not marked".
    expect(doReleaseFlag(instance('Pathway'), true)?.doRelease).toBe(false);
    expect(doReleaseFlag(instance('Pathway', null), true)?.doRelease).toBe(false);
  });

  it('renders nothing off the curator site, where the attribute is never sent', () => {
    expect(doReleaseFlag(instance('Pathway'), false)).toBeUndefined();
  });

  it('applies to every Event class, not just pathways', () => {
    for (const schemaClass of [
      'TopLevelPathway',
      'CellLineagePath',
      'Reaction',
      'BlackBoxEvent',
      'FailedReaction',
      'Polymerisation',
    ]) {
      expect(doReleaseFlag(instance(schemaClass, true), true)?.doRelease).toBe(true);
    }
  });

  it('renders nothing for a non-event, which has no doRelease attribute', () => {
    expect(doReleaseFlag(instance('Complex'), true)).toBeUndefined();
    expect(doReleaseFlag(instance('EntityWithAccessionedSequence'), true)).toBeUndefined();
  });

  it('renders nothing when there is no instance yet', () => {
    expect(doReleaseFlag(undefined, true)).toBeUndefined();
  });

  it('distinguishes the two states by icon as well as colour', () => {
    const marked = doReleaseFlag(instance('Pathway', true), true);
    const held = doReleaseFlag(instance('Pathway', false), true);
    expect(marked?.icon).not.toBe(held?.icon);
    expect(marked?.tooltip).not.toBe(held?.tooltip);
  });
});
