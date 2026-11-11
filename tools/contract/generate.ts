/**
 * The API description, generated from the contract (spec 016, US4): an
 * OpenAPI 3.1 document of every route the content service answers, with the
 * answer the contract has for it, and the rest listed as not yet in the
 * contract. What the contract does not hold -- each operation's group,
 * summary, notes, parameters and request body, and what an error status
 * means -- is Java's documentation of the operation (java-documentation.json,
 * snapshot-java-documentation.ts), merged in (T028), so the published
 * description says everything Java's did. Run as a script, it writes
 * projects/contract/openapi.json, which the content service publishes at
 * /ContentService/openapi.json; generate.spec.ts checks the committed file is
 * what this makes.
 *
 *   node tools/contract/generate.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';
import { RECORD } from '../content-node/parameters.ts';
import { endpoints } from '../content-node/registry.ts';
import { DOCUMENTATION } from './snapshot-java-documentation.ts';
import type { DocumentedOperation, JavaDocumentation } from './snapshot-java-documentation.ts';

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
  for (const schema of Object.values(definitions)) nameTags(schema);
  return { table: table.properties, definitions };
}

/**
 * A discriminated union (the graph's classes) lists its tag as required, here
 * and wherever it is written inline: name it as a property too, a string, which
 * is what a required field must be in ajv's strict mode (strictRequired), and
 * says no more than each class does.
 */
function nameTags(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(nameTags);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const schema = value as Schema;
  const tag = (schema['discriminator'] as { propertyName?: unknown } | undefined)?.propertyName;
  if (typeof tag === 'string' && !schema['properties'])
    schema['properties'] = { [tag]: { type: 'string' } };
  Object.values(schema).forEach(nameTags);
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

/** Where the content service's routes are, in Java's documentation (its paths carry none). */
const PREFIX = '/ContentService';

/** Java's documentation of its operations, as kept (snapshot-java-documentation.ts). */
const javaDocumentation = (): JavaDocumentation =>
  JSON.parse(readFileSync(DOCUMENTATION, 'utf8')) as JavaDocumentation;

/** A path template as a pattern of the paths it answers, each variable one segment or part of one. */
const templatePattern = (template: string) =>
  new RegExp(
    `^${template
      .split(/\{[^}]+\}/)
      .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}$`
  );

/**
 * The Java operation a served route answers for: the record's (parameters.ts)
 * for a GET it names one, or the one at the same path, its variables aside.
 */
function javaOperationOf(route: string, documented: string[]): string | undefined {
  const [method = '', where = ''] = route.split(' ');
  const recorded = method === 'GET' ? RECORD[where] : undefined;
  if (recorded) return recorded.java === null ? undefined : `GET ${PREFIX}${recorded.java}`;
  const shape = (path: string) => path.replace(/\{[^}]+\}/g, '{}');
  return documented.find((each) => {
    const [verb = '', path = ''] = each.split(' ');
    return verb === method && shape(path) === shape(where);
  });
}

/**
 * An operation's documentation on a path of the description: Java's
 * parameters, each path variable named as the path names it (the service's
 * names are not always Java's), its notes kept by position.
 */
function documented(java: DocumentedOperation | undefined, where: string) {
  const templated = pathParameters(where);
  if (!java) return { ...(templated.length ? { parameters: templated } : {}) };
  const { responses: _responses, parameters = [], ...rest } = java;
  const isPath = (parameter: unknown) =>
    typeof parameter === 'object' && parameter !== null && Reflect.get(parameter, 'in') === 'path';
  const javaPath = parameters.filter(isPath);
  const notes = (at: number): string | undefined => {
    const note: unknown =
      javaPath.length === templated.length
        ? Reflect.get(Object(javaPath[at]), 'description')
        : undefined;
    return typeof note === 'string' ? note : undefined;
  };
  const named = templated.map((parameter, at) => {
    const note = notes(at);
    return note ? { ...parameter, description: note } : parameter;
  });
  const all = [...named, ...parameters.filter((parameter) => !isPath(parameter))];
  return { ...rest, ...(all.length ? { parameters: all } : {}) };
}

/** What each status Java documents means; its answers' media types where the contract has no schema. */
function documentedResponses(java: DocumentedOperation | undefined, contract: boolean) {
  const out: Record<string, Schema> = {};
  for (const [status, answer] of Object.entries(java?.responses ?? {})) {
    if (status === '200' && contract) continue;
    out[status] = {
      description: status === '200' ? 'Not yet described by the contract.' : answer.description,
      ...(answer.mediaTypes
        ? { content: Object.fromEntries(answer.mediaTypes.map((type) => [type, {}])) }
        : {}),
    };
  }
  return out;
}

/**
 * What the service documents of the routes Java never had, where Java's
 * documentation would be: without it the API page shows such a route bare.
 */
const NODE_OPERATIONS: Record<string, DocumentedOperation> = {
  'GET /ContentService/expression/{id}': {
    tags: ['expression'],
    summary: "A selection's genes across the tissues of its species (spec 024)",
    description:
      "The genes of a pathway, reaction, complex, set, protein or reference entity, each with five values per tissue (minimum, quartiles, maximum TPM) exactly as Expression Atlas publishes them for the species' tissue experiment (E-MTAB-2836 for Homo sapiens), ordered so that genes expressed alike sit together; the genes that have no row, and why; and the experiment, with the citations its CC BY 4.0 licence asks for. A selection with no genes is `no-genes`; a species with no listed experiment is `species-not-available`. The genes are found from the selection, not passed: a pathway's thousands would not fit in an address.",
    parameters: [
      {
        in: 'path',
        name: 'id',
        description: 'A stable id or dbId of the selection, or a reference entity (uniprot:P10415)',
      },
    ],
    responses: {
      '404': { description: 'No object has this id.' },
      '503': { description: 'The expression data is not available here.' },
    },
  },
};

/** The OpenAPI document, as an object. */
export function generate() {
  const { table, definitions } = contractSchemas();
  const java = javaDocumentation();
  const javaOperations = new Map<string, DocumentedOperation>();
  for (const [where, methods] of Object.entries(java.paths))
    for (const [method, operation] of Object.entries(methods))
      javaOperations.set(`${method.toUpperCase()} ${PREFIX}${where}`, operation);
  const documentedRoutes = [...javaOperations.keys()];

  const served = servedRoutes();
  const routes = [...new Set([...served, ...Object.keys(table)])];
  // A served route Java documents under a narrower path (/exporter/diagram/{id}
  // for /exporter/diagram/{identifier}.{ext}) is listed as Java documents it;
  // an operation the service leaves to Java is listed too, as it is still the
  // content service's.
  const covering = (javaRoute: string) =>
    routes.find((route) => {
      const [method = '', where = ''] = route.split(' ');
      const [verb = '', path = ''] = javaRoute.split(' ');
      return method === verb && !table[route] && templatePattern(where).test(path);
    });
  const answered = new Map<string, string | undefined>();
  for (const route of routes) answered.set(route, javaOperationOf(route, documentedRoutes));
  const matched = new Set(answered.values());
  const listed = new Map<string, string | undefined>();
  for (const [route, javaRoute] of answered)
    if (
      javaRoute ||
      !documentedRoutes.some((each) => !matched.has(each) && covering(each) === route)
    )
      listed.set(route, javaRoute);
  for (const javaRoute of documentedRoutes)
    if (!matched.has(javaRoute)) listed.set(javaRoute, javaRoute);

  const paths: Record<string, Record<string, Schema>> = {};
  for (const route of [...listed.keys()].sort(byCodeUnit)) {
    const [method = '', where = ''] = route.split(' ');
    const answer = table[route];
    const javaRoute = listed.get(route);
    const javaOperation = javaRoute ? javaOperations.get(javaRoute) : NODE_OPERATIONS[route];
    (paths[where] ??= {})[method.toLowerCase()] = answer
      ? {
          ...documented(javaOperation, where),
          responses: {
            '200': {
              description: 'The answer.',
              content: { 'application/json': { schema: rewriteRefs(answer) } },
            },
            ...documentedResponses(javaOperation, true),
          },
        }
      : {
          'x-contract': 'not yet',
          ...documented(javaOperation, where),
          responses: {
            '200': { description: 'Not yet described by the contract.' },
            ...documentedResponses(javaOperation, false),
          },
        };
  }
  const schemas = components(definitions);
  return {
    openapi: '3.1.1',
    info: {
      ...java.info,
      title: 'Reactome Content Service',
      version: 'contract',
      description:
        'Each answer is generated from the shared contract (projects/contract); each operation, its parameters and its errors as the service documents them. An answer marked x-contract "not yet" is not yet described by the contract.',
    },
    tags: java.tags,
    paths,
    components: { schemas },
  };
}

/** The document as written: two-space JSON and a final newline. */
export const written = () => `${JSON.stringify(generate(), null, 2)}\n`;

if (import.meta.main) writeFileSync(DESCRIPTION, written());
