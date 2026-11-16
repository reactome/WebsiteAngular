/**
 * reaction-exporter's LayoutIndex (research D22, step 3): the participants
 * by role, each list sorted for placing. An entity is listed once per role:
 * one with two input roles is listed twice. Lists are sorted stably, as
 * List.sort is, so ties keep the order of the layout's entities (a hash set
 * of glyphs) and of each entity's roles.
 */
import type { CompartmentGlyph, EntityGlyph, ReactionGlyph } from './model.ts';
import type { Inputs } from './inputs.ts';

const CLASS_ORDER = [
  'ProcessNode',
  'EncapsulatedNode',
  'Complex',
  'EntitySet',
  'Protein',
  'RNA',
  'Chemical',
  'Gene',
  'Cell',
  'Entity',
];

/** String.compareTo: by UTF-16 code unit, then length. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** false before true (the index's FALSE_FIRST; the flags here are never null). */
const falseFirst = (a: boolean, b: boolean) => (a === b ? 0 : a ? 1 : -1);

/**
 * The comparator every list but the regulators uses: more roles first, then
 * not trivial, the class's place in CLASS_ORDER (-1, first, for a drug's
 * class), and the name.
 */
function byPlacing(a: EntityGlyph, b: EntityGlyph): number {
  return (
    b.roles.length - a.roles.length ||
    falseFirst(a.trivial, b.trivial) ||
    CLASS_ORDER.indexOf(a.renderableClass) - CLASS_ORDER.indexOf(b.renderableClass) ||
    compareStrings(a.name, b.name)
  );
}

const negative = (entity: EntityGlyph) => entity.roles.some((role) => role.type === 'negative');

export class LayoutIndex {
  readonly inputs: EntityGlyph[] = [];
  readonly outputs: EntityGlyph[] = [];
  readonly catalysts: EntityGlyph[] = [];
  readonly regulators: EntityGlyph[] = [];
  readonly reaction: ReactionGlyph;

  constructor({ reaction, entities }: Pick<Inputs, 'reaction' | 'entities'>) {
    this.reaction = reaction;
    const activators: EntityGlyph[] = [];
    const inhibitors: EntityGlyph[] = [];
    for (const entity of entities)
      for (const role of entity.roles) {
        if (role.type === 'input') this.inputs.push(entity);
        else if (role.type === 'output') this.outputs.push(entity);
        else if (role.type === 'catalyst') this.catalysts.push(entity);
        else if (role.type === 'negative') inhibitors.push(entity);
        else activators.push(entity);
      }
    this.regulators.push(...inhibitors, ...activators);
    this.inputs.sort(byPlacing);
    this.outputs.sort(byPlacing);
    this.catalysts.sort(byPlacing);
    // Regulators: negative ones first, after the number of roles.
    this.regulators.sort(
      (a, b) =>
        b.roles.length - a.roles.length ||
        falseFirst(negative(b), negative(a)) ||
        falseFirst(a.trivial, b.trivial) ||
        CLASS_ORDER.indexOf(a.renderableClass) - CLASS_ORDER.indexOf(b.renderableClass) ||
        compareStrings(a.name, b.name)
    );
    // An input that is also a catalyst is placed and wired as an input.
    const kept = this.catalysts.filter((entity) => !entity.roles.some((r) => r.type === 'input'));
    this.catalysts.splice(0, this.catalysts.length, ...kept);
  }

  filterInputs(compartment: CompartmentGlyph): EntityGlyph[] {
    return this.inputs.filter((entity) => entity.compartment === compartment);
  }

  filterOutputs(compartment: CompartmentGlyph): EntityGlyph[] {
    return this.outputs.filter((entity) => entity.compartment === compartment);
  }

  filterCatalysts(compartment: CompartmentGlyph): EntityGlyph[] {
    return this.catalysts.filter((entity) => entity.compartment === compartment);
  }

  filterRegulators(compartment: CompartmentGlyph): EntityGlyph[] {
    return this.regulators.filter((entity) => entity.compartment === compartment);
  }
}
