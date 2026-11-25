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
 * `{ title: 'Compartment', description: ... }` in place of its `$ref`. An
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

/** The graph class a `$ref` points at, by its own name, or undefined. */
function graphClassOf(ref: unknown): string | undefined {
  const name = typeof ref === 'string' ? REF.exec(ref)?.[1] : undefined;
  return name === undefined ? undefined : GRAPH_CLASS.exec(name)?.[1];
}

/** `schema` with each reference to a graph class replaced by its name. */
function named(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(named);
  if (!isRecord(schema)) return schema;
  const graphClass = graphClassOf(schema['$ref']);
  if (graphClass !== undefined)
    return {
      title: graphClass,
      type: 'object',
      description: `A ${graphClass}: its fields are under Schemas.`,
    };
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, named(value)]));
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
      return [name, { ...schema, properties: named(schema['properties']) }];
    })
  );
  return { ...description, components: { ...components, schemas: lighter } };
}
