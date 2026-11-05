// @vitest-environment node
//
// Step 1 of the reaction layout (research D22): the GO tree that joins a
// layout's compartments, and the copies DuplicateManager makes, on an
// invented tree and invented glyphs. The live comparison with Java is
// reaction-layout-check.ts; these pin the rules it relies on.
import { describe, expect, it } from 'vitest';
import { masterTree, treeWithIntermediateNodes } from './go-tree.ts';
import type { CellularComponent } from './go-tree.ts';
import { prepare } from './inputs.ts';
import type { Inputs } from './inputs.ts';
import { JavaHashMap } from '../java-hashmap.ts';
import {
  AttachmentGlyph,
  CompartmentGlyph,
  EntityGlyph,
  GlyphIds,
  GlyphSet,
  ReactionGlyph,
} from './model.ts';
import type { EntityRole } from './model.ts';

const ER = 'GO:0005576';
const CC = 'GO:0005575';

/** An invented component: what surrounds it, and what it is an instance of. */
const component = (id: string, surroundedBy: string[] = [], instanceOf: string[] = []) =>
  ({ id, name: `name of ${id}`, surroundedBy, instanceOf }) satisfies CellularComponent;

/** A tree as nested names, from its root down, children sorted for a stable reading. */
function shape(root: { id: string; incomingTerms(): Iterable<{ id: string }> }): unknown {
  const inner = [...root.incomingTerms()].map((term) => shape(term as Parameters<typeof shape>[0]));
  return inner.length ? { [root.id]: inner } : root.id;
}

describe('the master tree', () => {
  it('puts the cellular component inside the extracellular region, and clears its parents', () => {
    const tree = masterTree([component(CC), component(ER, [], ['GO:1']), component('GO:1')]);
    const er = tree.get(ER);
    expect([...(tree.get(CC)?.outgoingTerms() ?? [])].map((term) => term.id)).toEqual([ER]);
    expect(er?.parents).toEqual([]);
    // Its parent keeps it as a child: Java clears one side only.
    expect([...(tree.get('GO:1')?.children ?? [])].map((term) => term.id)).toEqual([ER]);
  });
});

describe('the tree joining the compartments asked for', () => {
  // GO:10 sits in GO:20 inside GO:30, or directly in GO:30; GO:30 in the
  // extracellular region.
  const master = masterTree([
    component(ER),
    component(CC),
    component('GO:30', [ER]),
    component('GO:20', ['GO:30']),
    component('GO:10', ['GO:20', 'GO:30']),
  ]);

  it('takes the shortest branch when no branch holds more of the compartments asked for', () => {
    const root = treeWithIntermediateNodes(master, ['GO:10', ER]);
    expect(root.id).toBe(ER);
    expect(shape(root)).toEqual({ [ER]: [{ 'GO:30': ['GO:10'] }] });
  });

  it('prefers the branch through more of the compartments asked for', () => {
    const root = treeWithIntermediateNodes(master, ['GO:10', 'GO:20', ER]);
    expect(shape(root)).toEqual({ [ER]: [{ 'GO:30': [{ 'GO:20': ['GO:10'] }] }] });
  });

  it('starts the tree at the outermost compartment that holds more than one', () => {
    // Nothing asked for is the extracellular region, so the root moves in
    // past the terms that hold only one.
    const root = treeWithIntermediateNodes(master, ['GO:10', 'GO:20']);
    expect(root.id).toBe('GO:20');
  });

  it('is the extracellular region alone when nothing is asked for', () => {
    expect(treeWithIntermediateNodes(master, []).id).toBe(ER);
  });
});

describe("DuplicateManager's copies", () => {
  /** A layout of one compartment, one reaction and the entities given, ids from 1. */
  function layout(entities: { roles: EntityRole[]; attachments?: number }[]): Inputs {
    const ids = new GlyphIds(1);
    const reaction = new ReactionGlyph(ids, {
      dbId: 1,
      stId: 'R-XXX-1',
      schemaClass: 'Reaction',
      displayName: 'a reaction',
      isInDisease: false,
      category: 'transition',
      speciesName: null,
      compartments: [],
    });
    const root = new CompartmentGlyph(ids, { name: 'root', accession: '0005576' });
    const glyphs = entities.map(({ roles, attachments = 0 }, at) => {
      const entity = new EntityGlyph(ids);
      Object.assign(entity, { dbId: 100 + at, stId: `R-XXX-${100 + at}`, name: `entity ${at}` });
      entity.roles = roles.map((type) => ({ type, n: 1 }));
      for (let n = 0; n < attachments; n += 1)
        entity.attachments.push(
          new AttachmentGlyph(ids, { dbId: 900 + n, schemaClass: 'X', label: 'p' })
        );
      entity.compartment = root;
      root.contained.add(entity);
      return entity;
    });
    reaction.compartment = root;
    const compartments = new JavaHashMap<string, CompartmentGlyph>();
    compartments.set(root.accession, root);
    return { pathway: 'null', reaction, entities: GlyphSet.of(glyphs), compartments, root, ids };
  }

  const roles = (inputs: Inputs) =>
    [...inputs.entities]
      .map((entity) => `${entity.name}: ${entity.roles.map((role) => role.type).join('+')}`)
      .sort();

  it('copies each role but the last that is neither an input nor a catalyst', () => {
    const inputs = layout([{ roles: ['output', 'negative', 'positive'] }]);
    prepare(inputs);
    expect(roles(inputs)).toEqual(['entity 0: negative', 'entity 0: output', 'entity 0: positive']);
  });

  it('leaves an input that is also a catalyst one glyph', () => {
    const inputs = layout([{ roles: ['input', 'catalyst'] }]);
    prepare(inputs);
    expect(roles(inputs)).toEqual(['entity 0: input+catalyst']);
  });

  it('gives a copy, and each of its attachments, the next ids', () => {
    // Reaction 1, root 2, entity 3 with attachments 4 and 5.
    const inputs = layout([{ roles: ['output', 'negative'], attachments: 2 }]);
    prepare(inputs);
    const copy = [...inputs.entities].find((entity) => entity.id !== 3);
    expect(copy?.id).toBe(6);
    expect(copy?.attachments.map((attachment) => attachment.id)).toEqual([7, 8]);
    expect(inputs.ids.next()).toBe(9);
  });
});
