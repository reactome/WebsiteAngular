// @vitest-environment node
//
// The reaction graph's rows as graph-core's ReflectionUtils.build fills
// diagram-reader's EntityNodeImpl and EventNodeImpl (research D22, step 4):
// field by field, by name, a Long with no value 0, a list with none empty.
import { describe, expect, it } from 'vitest';
import { diagramIdsByDbId, entityNode, eventNode } from './reaction-graph.ts';
import { JavaRuntimeException } from './model.ts';

describe('entityNode', () => {
  it('reads a row with every field', () => {
    expect(
      entityNode({
        dbId: 535476,
        stId: 'R-HSA-535476',
        displayName: 'EXTL3 [nucleoplasm]',
        schemaClass: 'EntityWithAccessionedSequence',
        speciesID: 48887,
        children: [12, 13],
        parents: [11],
        identifier: 'P17861-2',
        geneNames: ['XBP1'],
      })
    ).toEqual({
      parents: [11],
      children: [12, 13],
      identifier: 'P17861-2',
      geneNames: ['XBP1'],
      // Not in the query: an empty list, until setDiagramIds.
      diagramIds: [],
      dbId: 535476,
      stId: 'R-HSA-535476',
      displayName: 'EXTL3 [nucleoplasm]',
      schemaClass: 'EntityWithAccessionedSequence',
      speciesID: 48887,
    });
  });

  it('takes a null Long as 0 and a null list as empty, as asLong(0) and new ArrayList do', () => {
    const node = entityNode({ dbId: 29356, speciesID: null, geneNames: null, identifier: null });
    expect(node.speciesID).toBe(0);
    expect(node.geneNames).toEqual([]);
    expect(node.identifier).toBeNull();
  });

  it("fails as the driver's Uncoercible does on a value of another type", () => {
    expect(() => entityNode({ dbId: 1, geneNames: 'XBP1' })).toThrow(JavaRuntimeException);
    expect(() => entityNode({ dbId: 1, identifier: 7 })).toThrow(JavaRuntimeException);
  });
});

describe('eventNode', () => {
  it('drops the regulations, which match no field, and fills what the query lacks', () => {
    const node = eventNode({
      dbId: 1791144,
      stId: 'R-HSA-1791144',
      displayName: 'Binding',
      schemaClass: 'Reaction',
      inputs: [1],
      outputs: [2],
      catalysts: [],
      efs: [3],
      regulations: [{ type: 'NegativeRegulation', dbId: 4 }],
      preceding: [5],
      following: [],
    });
    expect(node.inhibitors).toEqual([]);
    expect(node.activators).toEqual([]);
    expect(node.requirements).toEqual([]);
    expect(node.efs).toEqual([3]);
    expect(node.speciesId).toBe(0);
    expect(Object.keys(node)).not.toContain('regulations');
  });
});

describe('diagramIdsByDbId', () => {
  it("lists each entity's glyphs in the order the layout's entities come", () => {
    const ids = diagramIdsByDbId([
      { dbId: 10, id: 9 },
      { dbId: 11, id: 4 },
      { dbId: 10, id: 7 },
    ]);
    expect(ids.get(10)).toEqual([9, 7]);
    expect(ids.get(11)).toEqual([4]);
    expect(ids.get(12)).toBeUndefined();
  });
});
