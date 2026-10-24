// @vitest-environment node
//
// /data/query/{id}/{attributeName}'s pieces in domain.ts: the getter found by
// name, its value as graph-core's LazyFetchAspect leaves it, and the text
// ControllerUtils.toTSV writes. The objects here are invented; the formats
// were measured against Java on 18 Oct 2026.
import { describe, expect, it } from 'vitest';
import {
  attributeGetter,
  attributeText,
  attributeValue,
  mapNodes,
  type DomainEntity,
} from './domain.ts';
import type { GraphNode } from './graph.ts';

const node = (id: number, labels: string[], props: GraphNode['props']): GraphNode => ({
  id,
  labels: ['DatabaseObject', ...labels],
  props,
});
/** The nodes, mapped together; one not mapped is the test's failure, not undefined. */
const mapped = <T extends GraphNode[]>(nodes: [...T]) => {
  const entities = mapNodes(nodes);
  if (entities.length !== nodes.length) throw new Error('not every node was mapped');
  return entities as { [K in keyof T]: DomainEntity };
};
/** A getter that exists; a missing one is the test's failure, not undefined. */
const getter = (schemaClass: string, attribute: string) => {
  const found = attributeGetter(schemaClass, attribute);
  if (!found) throw new Error(`${schemaClass} has no getter for ${attribute}`);
  return found;
};
/** What loads a relationship, as attributeValue asks for one. */
type LazyLoad = Parameters<typeof attributeValue>[2];
const [pathway] = mapped([
  node(1, ['Event', 'Pathway'], {
    dbId: 109581,
    stId: 'R-HSA-109581',
    displayName: 'Apoptosis',
    schemaClass: 'Pathway',
    name: ['Apoptosis', 'Cell death'],
    hasDiagram: true,
    diagramWidth: 770,
  }),
]);
const noLoads = async () => {
  throw new Error('nothing should be loaded');
};
const text = (value: unknown, returned?: { returns: string }) =>
  attributeText(value, (html) => `jsoup(${html})`, returned);

describe('attributeGetter', () => {
  it('finds the getter by name, ignoring case, as getProperty does', () => {
    expect(attributeGetter('Pathway', 'DISPLAYNAME')?.name).toBe('getDisplayName');
    expect(attributeGetter('Pathway', 'hasdiagram')?.name).toBe('getHasDiagram');
    expect(attributeGetter('Pathway', 'class')?.name).toBe('getClass');
    expect(attributeGetter('Pathway', 'getClass')).toBe(undefined);
    expect(attributeGetter('Pathway', 'xyz')).toBe(undefined);
  });
});

describe('attributeValue and attributeText', () => {
  it("writes values as Java's toString does, a list one item a line", async () => {
    const value = async (attribute: string) =>
      text(
        await attributeValue(pathway, getter('Pathway', attribute), noLoads),
        getter('Pathway', attribute)
      );
    expect(await value('displayName')).toBe('Apoptosis');
    expect(await value('dbId')).toBe('109581');
    expect(await value('hasDiagram')).toBe('true');
    expect(await value('name')).toBe('Apoptosis\nCell death\n');
    expect(await value('class')).toBe('class org.reactome.server.graph.domain.model.Pathway');
    expect(await value('schemaClass')).toBe('Pathway');
    expect(await value('explanation')).toBe(
      'A collection of related Events. These events can be ReactionLikeEvents or Pathways'
    );
  });

  it('writes an object as its id, text and class; a summation through Jsoup', () => {
    const [species, summation] = mapped([
      node(2, ['Taxon', 'Species'], {
        dbId: 48887,
        displayName: 'Homo sapiens',
        schemaClass: 'Species',
      }),
      node(3, ['Summation'], {
        dbId: 7,
        displayName: 'short',
        text: '<b>long</b>',
        schemaClass: 'Summation',
      }),
    ]);
    expect(text([species, summation])).toBe(
      '48887\tHomo sapiens\tSpecies\n7\tjsoup(<b>long</b>)\tSummation\n'
    );
  });

  it('loads an empty incoming relationship, as the aspect does, through its setter', async () => {
    const [entity] = mapped([
      node(4, ['PhysicalEntity', 'Complex'], {
        dbId: 5,
        stId: 'R-HSA-5',
        displayName: 'C',
        schemaClass: 'Complex',
      }),
    ]);
    const [a, b] = mapped([
      node(5, ['PhysicalEntity', 'Complex'], {
        dbId: 6,
        stId: 'R-HSA-6',
        displayName: 'A',
        schemaClass: 'Complex',
      }),
      node(6, ['PhysicalEntity', 'Complex'], {
        dbId: 7,
        stId: 'R-HSA-7',
        displayName: 'B',
        schemaClass: 'Complex',
      }),
    ]);
    const asked: unknown[][] = [];
    const load: LazyLoad = async (dbId, type, direction, wanted) => {
      asked.push([dbId, type, direction, wanted.element]);
      // A twice: a relationship of stoichiometry 2.
      return [a, a, b];
    };
    // The projected getter calls getComponentOf, which loads; its relations
    // then carry the order met and the times met.
    const value = await attributeValue(entity, getter('Complex', 'componentOfComplexes'), load);
    expect(asked).toEqual([[5, 'hasComponent', 'INCOMING', 'Complex']]);
    expect(text(value)).toBe(
      "Has{type=componentOf, stoichiometry=2, order=0, element=Complex {dbId=6, stId='R-HSA-6', displayName='A'}}\n" +
        "Has{type=componentOf, stoichiometry=1, order=1, element=Complex {dbId=7, stId='R-HSA-7', displayName='B'}}\n"
    );
    // The plain getter expands them again, and loads nothing more.
    const expanded = await attributeValue(entity, getter('Complex', 'componentOf'), noLoads);
    expect((expanded as DomainEntity[]).map((complex) => complex.properties['dbId'])).toEqual([
      6, 6, 7,
    ]);
  });

  it('never fetches an outgoing relationship again: findById brought it, even empty', async () => {
    const value = await attributeValue(pathway, getter('Pathway', 'hasEvent'), noLoads);
    expect(text(value ?? [])).toBe('');
  });

  it('writes a Double as Double.toString does, and an object without a stable id by its dbId', () => {
    expect(text(2, { returns: 'Double' })).toBe('2.0');
    expect(text(0.00001, { returns: 'Double' })).toBe('1.0E-5');
    expect(text(2, { returns: 'Integer' })).toBe('2');
    const [unnamed] = mapped([
      node(9, ['Taxon', 'Species'], { dbId: 9, stId: '', schemaClass: 'Species' }),
    ]);
    expect(text(unnamed)).toBe('9\tnull\tSpecies');
  });

  it('writes a relationship whose element has no stable id or name as Has.toString does', async () => {
    const [complex] = mapped([
      node(10, ['PhysicalEntity', 'Complex'], { dbId: 10, schemaClass: 'Complex' }),
    ]);
    const [part] = mapped([
      node(11, ['PhysicalEntity', 'SimpleEntity'], { dbId: 11, schemaClass: 'SimpleEntity' }),
    ]);
    const value = await attributeValue(
      complex,
      getter('Complex', 'componentOfComplexes'),
      async () => [part]
    );
    expect(text(value)).toBe(
      "Has{type=componentOf, stoichiometry=1, order=0, element=SimpleEntity {dbId=11, displayName='null'}}\n"
    );
  });
});

describe('the getters graph-core computes', () => {
  it("Person's created and modified are DatabaseObject's own", async () => {
    const [person] = mapped([node(12, ['Person'], { dbId: 12, schemaClass: 'Person' })]);
    const [created, modified] = mapped([
      node(13, ['InstanceEdit'], { dbId: 13, displayName: 'c', schemaClass: 'InstanceEdit' }),
      node(14, ['InstanceEdit'], { dbId: 14, displayName: 'm', schemaClass: 'InstanceEdit' }),
    ]);
    person.fields['created'] = created;
    person.fields['modified'] = modified;
    expect(text(await attributeValue(person, getter('Person', 'created'), noLoads))).toBe(
      '13\tc\tInstanceEdit'
    );
    expect(text(await attributeValue(person, getter('Person', 'modified'), noLoads))).toBe(
      '14\tm\tInstanceEdit'
    );
  });

  it("a pathway's encapsulated events, each as often as its stoichiometry", async () => {
    const [outer] = mapped([node(15, ['Event', 'Pathway'], { dbId: 15, schemaClass: 'Pathway' })]);
    const [inner] = mapped([
      node(16, ['Event', 'Pathway'], {
        dbId: 16,
        stId: 'R-HSA-16',
        displayName: 'i',
        schemaClass: 'Pathway',
      }),
    ]);
    outer.fields['hasEncapsulatedEvent'] = [{ element: inner, stoichiometry: 2, order: 0 }];
    const value = await attributeValue(outer, getter('Pathway', 'hasEncapsulatedEvent'), noLoads);
    expect(text(value)).toBe('R-HSA-16\ti\tPathway\nR-HSA-16\ti\tPathway\n');
  });

  it("a reference entity's database name with its spaces as dashes; none at all is Java's NullPointerException", async () => {
    const [entity] = mapped([
      node(17, ['ReferenceEntity', 'ReferenceGeneProduct'], {
        dbId: 17,
        databaseName: 'ENSEMBL Fungi x',
        schemaClass: 'ReferenceGeneProduct',
      }),
    ]);
    expect(
      await attributeValue(
        entity,
        getter('ReferenceGeneProduct', 'simplifiedDatabaseName'),
        noLoads
      )
    ).toBe('ENSEMBL-Fungi-x');
    const [none] = mapped([
      node(18, ['ReferenceEntity', 'ReferenceGeneProduct'], {
        dbId: 18,
        schemaClass: 'ReferenceGeneProduct',
      }),
    ]);
    await expect(
      attributeValue(none, getter('ReferenceGeneProduct', 'simplifiedDatabaseName'), noLoads)
    ).rejects.toThrow(/null/);
  });
});
