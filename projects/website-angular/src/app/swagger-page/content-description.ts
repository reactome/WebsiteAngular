/**
 * The content service's description, made light enough for Swagger UI to draw.
 *
 * Swagger UI resolves every `$ref` beneath an operation before it draws the
 * operation. The graph's classes refer to one another through their fields (a
 * Complex's compartment, its components, their species...), so for an answer
 * that is any of them -- an object by id, a reaction's participants -- that
 * walk took the page minutes or never ended, and froze it meanwhile.
 *
 * So within a graph class's fields, another graph class is named, not followed:
 * `{ title: 'Compartment_number', description: ... }` in place of its `$ref`. An
 * answer still lists its classes and each class its fields; the classes
 * themselves are each in the page's Schemas, whole. The description the
 * service publishes is unchanged.
 */

/** The graph classes' schemas, as the generator names them: by how a related object is referred to. */
const GRAPH_CLASS = /^(.+)_(number|JsogReference)$/;
const REF = /^#\/components\/schemas\/(.+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The graph schema a `$ref` points at, by its name in Schemas, or undefined. */
function graphSchemaOf(ref: unknown): string | undefined {
  const name = typeof ref === 'string' ? REF.exec(ref)?.[1] : undefined;
  return name !== undefined && GRAPH_CLASS.test(name) ? name : undefined;
}

/**
 * `schema` with each reference to a graph schema replaced by its name, as
 * Schemas lists it: a class, whose fields are there, or a union of classes.
 */
function named(schema: unknown, schemas: Record<string, unknown>): unknown {
  if (Array.isArray(schema)) return schema.map((item) => named(item, schemas));
  if (!isRecord(schema)) return schema;
  const name = graphSchemaOf(schema['$ref']);
  if (name !== undefined) {
    const target = schemas[name];
    const union =
      isRecord(target) && (Array.isArray(target['oneOf']) || Array.isArray(target['anyOf']));
    return {
      title: name,
      type: 'object',
      description: union
        ? `One of the classes ${name} lists, under Schemas.`
        : `Its fields are under ${name}, in Schemas.`,
    };
  }
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, named(value, schemas)])
  );
}

/**
 * The description with every graph class's fields naming, not following, the
 * graph classes they hold. Anything else, and a description that is not one,
 * is returned as it was.
 */
export function withNamedGraphFields(description: unknown): unknown {
  if (!isRecord(description) || !isRecord(description['components'])) return description;
  const components = description['components'];
  const schemas = components['schemas'];
  if (!isRecord(schemas)) return description;
  const lighter = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      if (!GRAPH_CLASS.test(name) || !isRecord(schema) || !isRecord(schema['properties']))
        return [name, schema];
      return [name, { ...schema, properties: named(schema['properties'], schemas) }];
    })
  );
  return { ...description, components: { ...components, schemas: lighter } };
}
