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

// A Figure holds nothing but the path of an image file, so the path is the
// whole instance: as plain text it tells a curator that a file is named, but
// not whether it is the right picture or whether it is there at all. These
// pin that the path is carried as a link to the image itself.
describe("the instance browser's figure links", () => {
  const urlOf = (instance: PlainGraphObject) =>
    schemaRows(instance, [attribute('url', false)]).find((row) => row.name === 'url')?.values;

  it('offer the url of a figure as a link to the image file', () => {
    // Root-relative and left exactly as the database stores it -- the template
    // uses it as the href -- so the image is fetched from whichever origin
    // serves the page: localhost behind the dev server's /figures proxy, the
    // site itself once deployed.
    expect(
      urlOf({
        dbId: 975561,
        displayName: '/figures/12_GlcNAc2Man9PPDol.png',
        url: '/figures/12_GlcNAc2Man9PPDol.png',
        schemaClass: 'Figure',
      })
    ).toEqual([{ type: 'figure', text: '/figures/12_GlcNAc2Man9PPDol.png' }]);
  });

  it('leave a url that is not a figure path as text', () => {
    expect(
      urlOf({
        dbId: 1,
        displayName: 'UniProt',
        url: 'https://www.uniprot.org',
        schemaClass: 'ReferenceDatabase',
      })
    ).toEqual([{ type: 'text', text: 'https://www.uniprot.org' }]);
  });

  it('do not take the bare /figures/ directory for an image', () => {
    expect(
      urlOf({ dbId: 2, displayName: '/figures/', url: '/figures/', schemaClass: 'Figure' })
    ).toEqual([{ type: 'text', text: '/figures/' }]);
  });
});
