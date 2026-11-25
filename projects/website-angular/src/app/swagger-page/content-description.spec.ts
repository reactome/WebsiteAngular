import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withNamedGraphFields } from './content-description';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// Two graph classes that refer to each other, a union of them, and a class that is not the graph's.
const description = {
  openapi: '3.0.3',
  paths: { '/x': { get: { responses: { '200': { description: 'The answer.' } } } } },
  components: {
    schemas: {
      PhysicalEntity_number: { oneOf: [ref('Complex_number'), ref('Compartment_number')] },
      Complex_number: {
        type: 'object',
        required: ['dbId'],
        properties: {
          dbId: { type: 'number' },
          compartment: {
            type: 'array',
            items: { anyOf: [ref('Compartment_number'), { type: 'number' }] },
          },
          summary: ref('SearchEntry'),
        },
      },
      Compartment_number: {
        type: 'object',
        properties: { complexes: { items: ref('Complex_number') } },
      },
      SearchEntry: { type: 'object', properties: { other: ref('Complex_number') } },
    },
  },
};

describe("the content service's description, on the API page", () => {
  const lighter = withNamedGraphFields(description) as typeof description;
  const schemas = lighter.components.schemas;

  it("names, not follows, the graph classes in a graph class's fields", () => {
    expect(schemas.Complex_number.properties.compartment.items.anyOf[0]).toEqual({
      title: 'Compartment',
      type: 'object',
      description: 'A Compartment: its fields are under Schemas.',
    });
    expect(schemas.Compartment_number.properties.complexes.items).toMatchObject({
      title: 'Complex',
    });
  });

  it('keeps the rest: the other fields, a union of classes, the classes that are not the graph', () => {
    expect(schemas.Complex_number.properties.dbId).toEqual({ type: 'number' });
    expect(schemas.Complex_number.properties.summary).toEqual(ref('SearchEntry'));
    expect(schemas.Complex_number.required).toEqual(['dbId']);
    expect(schemas.PhysicalEntity_number).toEqual(
      description.components.schemas.PhysicalEntity_number
    );
    expect(schemas.SearchEntry).toEqual(description.components.schemas.SearchEntry);
    expect(lighter.paths).toEqual(description.paths);
  });

  it('leaves the description as published alone, and anything else as it was', () => {
    expect(
      description.components.schemas.Complex_number.properties.compartment.items.anyOf[0]
    ).toEqual(ref('Compartment_number'));
    expect(withNamedGraphFields('not a description')).toBe('not a description');
    expect(withNamedGraphFields({ openapi: '3.0.3' })).toEqual({ openapi: '3.0.3' });
  });

  // The published description: no graph class's fields refer to another graph class any more.
  it('leaves no graph class following another, in the description the service publishes', () => {
    const published = JSON.parse(readFileSync('projects/contract/openapi.json', 'utf8')) as unknown;
    const text = JSON.stringify(
      (withNamedGraphFields(published) as typeof description).components.schemas
    );
    const schemasOf = JSON.parse(text) as Record<string, { properties?: unknown }>;
    const following = Object.entries(schemasOf)
      .filter(([name]) => /_(number|JsogReference)$/.test(name))
      .filter(([, schema]) =>
        /"\$ref":"#\/components\/schemas\/[^"]+_(number|JsogReference)"/.test(
          JSON.stringify(schema.properties ?? {})
        )
      )
      .map(([name]) => name);
    expect(following).toEqual([]);
  });
});
