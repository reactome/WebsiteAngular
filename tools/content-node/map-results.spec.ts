// @vitest-environment node
//
// mapResults: many records mapped as Neo4jTemplate.findAll maps them, with one
// KnownObjects -- /data/pathway/{id}/containedEvents. The graph here is
// invented: a pathway P with two events below it, A and B, each its own
// record, as graph-core's getContainedEvents query returns them.
import { describe, expect, it } from 'vitest';
import { mapResults, writeDomain, type DomainEntity, type MappedRow } from './domain.ts';
import type { GraphNode } from './graph.ts';

const node = (id: number, labels: string[], props: GraphNode['props']): GraphNode => ({
  id,
  labels: ['DatabaseObject', 'Event', ...labels],
  props,
});
const P = node(1, ['Pathway'], {
  dbId: 100,
  stId: 'R-HSA-100',
  displayName: 'P',
  schemaClass: 'Pathway',
});
const A = node(2, ['ReactionLikeEvent', 'Reaction'], {
  dbId: 200,
  stId: 'R-HSA-200',
  displayName: 'A',
  schemaClass: 'Reaction',
});
const B = node(3, ['ReactionLikeEvent', 'Reaction'], {
  dbId: 300,
  stId: 'R-HSA-300',
  displayName: 'B',
  schemaClass: 'Reaction',
});
const hasEvent = (id: number, start: number, end: number, order: number) => ({
  id,
  type: 'hasEvent',
  start,
  end,
  props: { order, stoichiometry: 1 },
});
const records: MappedRow[] = [
  { root: A, nodes: [P], relationships: [hasEvent(10, 1, 2, 1)] },
  { root: B, nodes: [P], relationships: [hasEvent(11, 1, 3, 0)] },
];

/** A relationship field of a mapped object: its related objects, in order. */
const related = (object: DomainEntity | undefined, name: string) => {
  if (!object) throw new Error('no object mapped');
  return object.fields[name] as { element: DomainEntity }[];
};
/** The first object related by `name`; none is a failure, not undefined. */
const first = (object: DomainEntity | undefined, name: string) => {
  const [relation] = related(object, name);
  if (!relation) throw new Error(`nothing in ${name}`);
  return relation.element;
};

describe('mapResults', () => {
  it('makes a node one object across records', () => {
    const [a, b] = mapResults(records);
    expect(first(a, 'eventOf')).toBe(first(b, 'eventOf'));
  });

  it('fills an object met again from the later record, merging what it held', () => {
    const [a] = mapResults(records);
    const pathway = first(a, 'eventOf');
    // P.hasEvent held A from the first record; the second adds B, and the
    // TreeSet of relationships puts them in their order.
    expect(
      related(pathway, 'hasEvent').map((relation) => relation.element.properties['stId'])
    ).toEqual(['R-HSA-300', 'R-HSA-200']);
  });

  it('writes the list with identity across it: an event already written is its dbId', () => {
    const text = writeDomain(mapResults(records));
    const written = JSON.parse(text) as [{ dbId: number }, number];
    expect(written[0].dbId).toBe(200);
    // B was written inside P inside A, so the list's second entry is its id.
    expect(written[1]).toBe(300);
  });
});
