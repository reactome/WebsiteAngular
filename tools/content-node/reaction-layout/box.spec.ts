// @vitest-environment node
//
// Step 3 of the reaction layout (research D22): the rules of Box that the
// live comparison seldom meets, on an invented compartment tree.
import { describe, expect, it } from 'vitest';
import { JavaHashMap } from '../java-hashmap.ts';
import { Box } from './box.ts';
import { LayoutIndex } from './layout-index.ts';
import { GlyphsLayout } from './layouts.ts';
import { CompartmentGlyph, EntityGlyph, GlyphIds, GlyphSet, ReactionGlyph } from './model.ts';
import type { EntityRole } from './model.ts';

const ids = () => new GlyphIds(1);

function compartment(glyphIds: GlyphIds, name: string, parent?: CompartmentGlyph) {
  const glyph = new CompartmentGlyph(glyphIds, { name, accession: name });
  if (parent) {
    parent.children.add(glyph);
    glyph.setParent(parent);
  }
  return glyph;
}

function reaction(glyphIds: GlyphIds, inside: CompartmentGlyph) {
  const glyph = new ReactionGlyph(glyphIds, {
    dbId: 1,
    stId: 'R-XXX-1',
    schemaClass: 'Reaction',
    displayName: 'a reaction',
    isInDisease: false,
    category: null,
    speciesName: null,
    compartments: [],
  });
  glyph.compartment = inside;
  inside.contained.add(glyph);
  return glyph;
}

function entity(glyphIds: GlyphIds, name: string, type: EntityRole, inside: CompartmentGlyph) {
  const glyph = new EntityGlyph(glyphIds);
  Object.assign(glyph, { dbId: 100, stId: `R-XXX-${name}`, name, renderableClass: 'Entity' });
  glyph.roles = [{ type, n: 1 }];
  glyph.compartment = inside;
  inside.contained.add(glyph);
  return glyph;
}

describe('a box re-placed in a taller parent', () => {
  // R holds A and B side by side. A holds A1 (an input) left of A2 (the
  // reaction), and is shorter than B, which holds a box in a box. Stretching
  // A to B's height places each of its children at row 2, column 2 again:
  // the second replaces the first, whose old cell is left to A2 as well.
  const glyphIds = ids();
  const r = compartment(glyphIds, 'R');
  const a = compartment(glyphIds, 'A', r);
  const b = compartment(glyphIds, 'B', r);
  const a1 = compartment(glyphIds, 'A1', a);
  const a2 = compartment(glyphIds, 'A2', a);
  compartment(glyphIds, 'B11', compartment(glyphIds, 'B1', b));
  const the = reaction(glyphIds, a2);
  const input = entity(glyphIds, 'input', 'input', a1);
  const index = new LayoutIndex({ reaction: the, entities: GlyphSet.of([input]) });
  const root = new Box(r, index);

  it('loses the first child, and holds the second twice', () => {
    expect([root.rows, root.columns]).toEqual([15, 27]);
    const position = root.placeReaction();
    expect(position).toEqual({ row: 7, col: 9 });
    root.placeElements(position as { row: number; col: number });
    const layouts = root
      .divs()
      .flat()
      .filter((div): div is GlyphsLayout => div instanceof GlyphsLayout);
    // The reaction's layout in both of A2's cells, and the input nowhere.
    expect(layouts.map((layout) => layout.glyphs.map((glyph) => glyph.id))).toEqual([
      [the.id],
      [the.id],
    ]);
  });
});

describe("a box's rows", () => {
  it('iterate as a HashMap<Integer, …> filled by computeIfAbsent does, under JDK 11', () => {
    // Rows from 16 on share buckets with the rows 16 below them, and
    // computeIfAbsent puts a new key at the head of its bucket; put, at the tail.
    const rows = [2, 18, 0, 34, 16, 5, 21];
    const filled = new JavaHashMap<number, string>({ hash: (key) => key });
    for (const row of rows) filled.computeIfAbsent(row, () => '');
    expect([...filled.keys()]).toEqual([16, 0, 34, 18, 2, 21, 5]);
    const put = new JavaHashMap<number, string>({ hash: (key) => key });
    for (const row of rows) put.set(row, '');
    expect([...put.keys()]).toEqual([0, 16, 2, 18, 34, 5, 21]);
  });
});
