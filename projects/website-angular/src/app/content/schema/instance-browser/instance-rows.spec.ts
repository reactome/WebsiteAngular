import { describe, expect, it } from 'vitest';
import type { SchemaAttribute } from '../../../../model/content.model';
import type { PlainGraphObject } from '../../../../../../pathway-browser/src/app/model/graph/plain.model';
import { fieldRows, schemaRows } from './instance-rows';

/**
 * An instance as /data/query/enhanced/{id} writes it without includeRef: an
 * object written already is its dbId. Invented, in a complex's shape.
 */
const INSTANCE: PlainGraphObject = {
  dbId: 100,
  displayName: 'A complex [cytosol]',
  schemaClass: 'Complex',
  stId: 'R-HSA-100',
  hasComponent: [
    { dbId: 200, stId: 'R-ALL-200', displayName: 'A part', schemaClass: 'SimpleEntity' },
    300,
  ],
  isChimeric: false,
};

const attribute = (name: string, databaseObject: boolean): SchemaAttribute => ({
  name,
  cardinality: '1',
  valueTypes: [{ name: databaseObject ? 'PhysicalEntity' : 'String', databaseObject }],
  origin: 'Complex',
});

describe("the instance browser's rows", () => {
  it("are the schema's attributes: an object and a dbId as links, the rest as text", () => {
    expect(
      schemaRows(INSTANCE, [
        attribute('hasComponent', true),
        attribute('displayName', false),
        attribute('compartment', true),
        attribute('isChimeric', false),
      ])
    ).toEqual([
      {
        name: 'hasComponent',
        values: [
          {
            type: 'link',
            text: '[SimpleEntity:200] A part',
            dbId: 200,
            schemaClass: 'SimpleEntity',
          },
          { type: 'link', text: '300', dbId: 300 },
        ],
      },
      { name: 'displayName', values: [{ type: 'text', text: 'A complex [cytosol]' }] },
      // An attribute the instance has no value for is left out.
      { name: 'isChimeric', values: [{ type: 'text', text: 'false' }] },
    ]);
  });

  it("are the instance's own fields when the schema cannot be read", () => {
    const rows = fieldRows(INSTANCE);
    expect(rows.map((row) => row.name)).toEqual([
      'dbId',
      'displayName',
      'schemaClass',
      'stId',
      'hasComponent',
      'isChimeric',
    ]);
    // Without the schema a bare number is text, not a link.
    expect(rows.find((row) => row.name === 'hasComponent')?.values[1]).toEqual({
      type: 'text',
      text: '300',
    });
  });
});
