// @vitest-environment node
//
// Step 3 of the reaction layout (research D22): the order LayoutIndex places
// each role's participants in, and the grid the BOX algorithm compacts.
import { describe, expect, it } from 'vitest';
import { Grid } from './grid.ts';
import { LayoutIndex } from './layout-index.ts';
import { CompartmentGlyph, EntityGlyph, GlyphIds, GlyphSet, ReactionGlyph } from './model.ts';
import type { EntityRole } from './model.ts';

describe("the index's lists", () => {
  const ids = new GlyphIds(1);
  const reaction = new ReactionGlyph(ids, {
    dbId: 1,
    stId: 'R-XXX-1',
    schemaClass: 'Reaction',
    displayName: 'a reaction',
    isInDisease: false,
    category: null,
    speciesName: null,
    compartments: [],
  });
  const root = new CompartmentGlyph(ids, { name: 'root', accession: '1' });
  const make = (name: string, renderableClass: string, roles: EntityRole[], trivial = false) => {
    const entity = new EntityGlyph(ids);
    Object.assign(entity, { name, renderableClass, trivial, compartment: root });
    entity.roles = roles.map((type) => ({ type, n: 1 }));
    return entity;
  };
  const glyphs = [
    make('b', 'Protein', ['input']),
    make('a', 'Protein', ['input']),
    make('B', 'Protein', ['input']),
    make('water', 'Chemical', ['input'], true),
    make('drug', 'ChemicalDrug', ['input']),
    make('complex', 'Complex', ['input']),
    make('both', 'Entity', ['input', 'catalyst']),
    make('twice', 'Gene', ['input', 'input']),
    make('activator', 'Protein', ['positive']),
    make('inhibitor', 'Protein', ['negative']),
    make('catalyst', 'Protein', ['catalyst']),
  ];
  const index = new LayoutIndex({ reaction, entities: GlyphSet.of(glyphs) });
  const names = (list: EntityGlyph[]) => list.map((entity) => entity.name);

  it('puts more roles first, then non-trivial, then by class, a drug first, then by name', () => {
    // An entity with two input roles is listed twice; a gene's class comes before an entity's.
    expect(names(index.inputs)).toEqual([
      'twice',
      'twice',
      'both',
      'drug',
      'complex',
      'B',
      'a',
      'b',
      'water',
    ]);
  });

  it('puts negative regulators first, and leaves an input out of the catalysts', () => {
    expect(names(index.regulators)).toEqual(['inhibitor', 'activator']);
    expect(names(index.catalysts)).toEqual(['catalyst']);
    expect(names(index.filterInputs(root))).toEqual(names(index.inputs));
  });
});

describe('the grid', () => {
  it('hands out its own rows, which stay its own across an insertion, and copies of columns', () => {
    const grid = new Grid<string>(2, 2);
    grid.set(0, 0, 'a');
    const row = grid.getRow(0) as (string | null)[];
    grid.insertRow(1);
    grid.set(0, 1, 'b');
    expect(row).toEqual(['a', 'b']);
    const column = grid.getColumn(0) as (string | null)[];
    grid.set(2, 0, 'c');
    expect(column).toEqual(['a', null, null]);
    expect(grid.getColumn(0)).toEqual(['a', null, 'c']);
  });

  it("grows when set past its edge, and answers Java's exception when read past it", () => {
    const grid = new Grid<string>(1, 1);
    grid.set(2, 3, 'x');
    expect([grid.rows, grid.columns]).toEqual([3, 4]);
    expect(grid.get(2, 3)).toBe('x');
    expect(() => grid.get(3, 0)).toThrow('Index 3 out of bounds for length 3');
    grid.removeRows(0, 2);
    grid.removeColumns(0, 3);
    expect([grid.rows, grid.columns, grid.get(0, 0)]).toEqual([1, 1, 'x']);
  });
});
