/**
 * The API description, generated from the contract (spec 016, US4): an
 * OpenAPI 3.1 document of every route the content service answers, with the
 * answer the contract has for it, and the rest listed as not yet in the
 * contract. Run as a script, it writes projects/contract/openapi.json;
 * generate.spec.ts checks the committed file is what this makes.
 *
 *   node tools/contract/generate.ts
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';
import { endpoints } from '../content-node/registry.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DESCRIPTION = path.join(ROOT, 'projects/contract/openapi.json');

type Schema = { [key: string]: unknown };

/**
 * A component name OpenAPI accepts (`^[a-zA-Z0-9._-]+$`): the generator names
 * an instance of a generic type `GroupedResult<SearchEntry>`.
 */
export const componentName = (name: string) => name.replace(/[<>, ]+/g, '_').replace(/_+$/, '');

/** Every `$ref` in a schema, rewritten to a component, by name. */
function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value === null || typeof value !== 'object') return value;
  const out: Schema = {};
  for (const [key, inner] of Object.entries(value as Schema))
    out[key] =
      key === '$ref' && typeof inner === 'string'
        ? `#/components/schemas/${componentName(decodeURIComponent(inner.replace('#/definitions/', '')))}`
        : rewriteRefs(inner);
  return out;
}

/** The registry's routes, as "METHOD /path". */
export function servedRoutes(): string[] {
  return endpoints.map((each) => `${(each.method ?? 'get').toUpperCase()} ${each.path}`);
}

/** The contract's route table: "METHOD /path" to its answer's schema, and the shared definitions. */
function contractSchemas() {
  const schema = createGenerator({
    path: path.join(ROOT, 'projects/contract/routes.ts'),
    tsconfig: path.join(ROOT, 'tools/tsconfig.json'),
    type: 'Routes',
    // The type checks have run already (check:types); the generator's own
    // would repeat them, slower.
    skipTypeCheck: true,
    discriminatorType: 'open-api',
    expose: 'export',
    topRef: true,
    jsDoc: 'extended',
    additionalProperties: false,
  }).createSchema('Routes');
  const definitions = { ...(schema.definitions ?? {}) } as Record<string, Schema>;
  const table = definitions['Routes'] as { properties: Record<string, Schema> };
  delete definitions['Routes'];
  // The search entry's kinds share no single tag (a deleted entry keeps the
  // type it had), so it has no discriminator, and the generator writes its
  // union as anyOf, which accepts an entry matching two kinds. Exactly one.
  const entry = definitions['SearchEntry'];
  if (entry?.['anyOf']) {
    entry['oneOf'] = entry['anyOf'];
    delete entry['anyOf'];
  }
  return { table: table.properties, definitions };
}

/** The route table's routes, as "METHOD /path": what the contract describes. */
export const contractRoutes = () => Object.keys(contractSchemas().table);

/** Code-unit order, the same in every locale (localeCompare is not). */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A templated path's variables, as OpenAPI requires them declared: text, as
 * the service reads them (an id may be a stable id or a dbId).
 */
const pathParameters = (where: string) =>
  [...where.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));

/**
 * The definitions as components, by their valid names, in code-unit order.
 * Two types named alike once made valid (A<B, C> and A<B_C>) would leave one
 * schema in place of two, and nothing would say so: that fails here.
 */
export function components(definitions: Record<string, unknown>): Record<string, unknown> {
  const named = Object.entries(definitions).map(
    ([name, schema]) => [componentName(name), rewriteRefs(schema)] as const
  );
  const clashes = named.filter(([name], at) => named.findIndex(([other]) => other === name) !== at);
  if (clashes.length)
    throw new Error(`component names clash: ${clashes.map(([name]) => name).join(', ')}`);
  return Object.fromEntries(named.sort(([a], [b]) => byCodeUnit(a, b)));
}

/** The OpenAPI document, as an object. */
export function generate() {
  const { table, definitions } = contractSchemas();
  const paths: Record<string, Record<string, Schema>> = {};
  const served = servedRoutes();
  for (const route of [...new Set([...served, ...Object.keys(table)])].sort(byCodeUnit)) {
    const [method = '', where = ''] = route.split(' ');
    const answer = table[route];
    const parameters = pathParameters(where);
    (paths[where] ??= {})[method.toLowerCase()] = answer
      ? {
          ...(parameters.length ? { parameters } : {}),
          responses: {
            '200': {
              description: 'The answer.',
              content: { 'application/json': { schema: rewriteRefs(answer) } },
            },
          },
        }
      : {
          'x-contract': 'not yet',
          ...(parameters.length ? { parameters } : {}),
          responses: { '200': { description: 'Not yet described by the contract.' } },
        };
  }
  const schemas = components(definitions);
  return {
    openapi: '3.1.1',
    info: {
      title: 'Reactome Content Service',
      version: 'contract',
      description:
        'Generated from the shared contract (projects/contract). A route marked x-contract "not yet" is answered by the service but not yet described here.',
    },
    paths,
    components: { schemas },
  };
}

/** The document as written: two-space JSON and a final newline. */
export const written = () => `${JSON.stringify(generate(), null, 2)}\n`;

if (import.meta.main) writeFileSync(DESCRIPTION, written());
