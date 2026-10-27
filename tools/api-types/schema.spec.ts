// @vitest-environment node
//
// Every recorded answer of a route the contract describes, against the schema
// the API description gives it (spec 016, T021): ajv over openapi.json, the
// generated description, where content.spec.ts compiles answers against the
// site's types. The two are checked apart: the generator is an approximation
// of the types, and this holds what it wrote to the answers.
import { readFileSync } from 'node:fs';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DESCRIPTION } from '../contract/generate.ts';
import { recordedAnswers, type RecordedAnswer } from './answers.ts';

type Schema = Record<string, unknown>;
interface Description {
  paths: Record<string, Record<string, Schema>>;
  components: { schemas: Record<string, Schema> };
}

const PREFIX = '/ContentService';
const DEFINITIONS = 'contract.json';
const INT64 = { min: -(2n ** 63n), max: 2n ** 63n - 1n };

/**
 * A JSON answer as the check reads it: an integer beyond 2^53 is kept exact,
 * as a bigint, where JSON.parse would round it (a replacement dbId is a Java
 * long, written exactly).
 */
function parse(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value) &&
    context?.source &&
    /^-?\d+$/.test(context.source)
      ? BigInt(context.source)
      : value
  );
}

/**
 * The description's Long, `{type: integer, format: int64}`, as ajv can check
 * it: ajv's `integer` is a JS number, so an exact long read as a bigint would
 * fail it. Anywhere else a bigint fails, as it should: a field the contract
 * does not call a Long cannot carry one exactly. `int64` is registered as no
 * format: written anywhere but the Long, it is refused (strict mode), so a
 * long the description spells out in place is not checked as a number.
 */
const LONG = { type: 'integer', format: 'int64' };

/** An ajv for the description: draft 2020-12, its definitions under DEFINITIONS. */
function validator(description: Description): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
    discriminator: true,
  });
  ajv.addKeyword({
    keyword: 'x-long',
    schemaType: 'boolean',
    validate: (_: boolean, value: unknown) =>
      typeof value === 'bigint'
        ? value >= INT64.min && value <= INT64.max
        : typeof value === 'number' && Number.isSafeInteger(value),
  });
  const schemas = { ...description.components.schemas };
  const { type, format } = schemas['Long'] ?? {};
  if (type !== LONG.type || format !== LONG.format)
    throw new Error(`Long is not ${JSON.stringify(LONG)}: revisit how this check reads it`);
  schemas['Long'] = { 'x-long': true };
  ajv.addSchema(refsTo({ $id: DEFINITIONS, $defs: schemas }) as Schema);
  return ajv;
}

/** Every `$ref` to a component pointed at DEFINITIONS' $defs. */
function refsTo(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(refsTo);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Schema).map(([key, inner]) => [
      key,
      key === '$ref' && typeof inner === 'string'
        ? inner.replace('#/components/schemas/', `${DEFINITIONS}#/$defs/`)
        : refsTo(inner),
    ])
  );
}

/** Every route the description lists, described or not yet, as "METHOD /path". */
function listed(description: Description): string[] {
  return Object.entries(description.paths).flatMap(([where, operations]) =>
    Object.keys(operations).map((method) => `${method.toUpperCase()} ${where}`)
  );
}

/** The routes the description gives an answer's schema: "METHOD /path" to the schema. */
function described(description: Description): Map<string, Schema> {
  const found = new Map<string, Schema>();
  for (const [where, operations] of Object.entries(description.paths))
    for (const [method, operation] of Object.entries(operations)) {
      const responses = operation['responses'] as Record<string, Schema> | undefined;
      const content = responses?.['200']?.['content'] as Record<string, Schema> | undefined;
      const schema = content?.['application/json']?.['schema'] as Schema | undefined;
      if (schema) found.set(`${method.toUpperCase()} ${where}`, schema);
    }
  return found;
}

/**
 * The route, of those given, a recorded answer is the answer of: a path written out
 * in full before a templated one (`/search/icon/query` before
 * `/search/icon/{identifier}`), as Spring prefers it; a trailing slash taken.
 */
function routeOf(routes: string[], method: string, where: string): string | undefined {
  const candidates = routes
    .map((route) => {
      const [verb = '', template = ''] = route.split(' ');
      const variables = (template.match(/\{[^}]+\}/g) ?? []).length;
      const pattern = template
        .split(/\{[^}]+\}/)
        .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
        .join('[^/]+');
      return { route, verb, variables, pattern: new RegExp(`^${pattern}/?$`) };
    })
    .filter((c) => c.verb === method && c.pattern.test(`${PREFIX}${where}`))
    .sort((a, b) => a.variables - b.variables);
  return candidates[0]?.route;
}

/**
 * ajv's errors as problems, one per failing value. A union's failure counts
 * once, at the union: ajv also lists each branch's errors, at the union's
 * value or within it. And the errors of one value (two required properties
 * missing) are one problem. Which errors came from a branch is told by where
 * they are, not by their schema path (a branch reached through a `$ref` has
 * its own), so a failure beside a union, at or within its value, waits until
 * the union's own is fixed; the answer fails either way.
 */
function problems(errors: ErrorObject[] | null | undefined): ErrorObject[] {
  const all = errors ?? [];
  const isUnion = (e: ErrorObject) => e.keyword === 'oneOf' || e.keyword === 'anyOf';
  const unions = all.filter(isUnion).map((e) => e.instancePath);
  const within = (at: string, of: string) => at.startsWith(`${of}/`);
  const branch = (e: ErrorObject) =>
    unions.some((of) => within(e.instancePath, of) || (!isUnion(e) && e.instancePath === of));
  const seen = new Set<string>();
  return all
    .filter((e) => !branch(e))
    .filter((e) => !seen.has(e.instancePath) && !!seen.add(e.instancePath));
}

/** A problem as one line: where, and what (no value: answers carry people's names). */
const line = (route: string, source: string, e: ErrorObject) =>
  `${route} (${source}) ${e.instancePath || '/'}: ${e.message ?? e.keyword}`;

const description = JSON.parse(readFileSync(DESCRIPTION, 'utf8')) as Description;

/** Each described route's recorded answers, checked: the problems as lines. */
function check(of: Description, answers: RecordedAnswer[]) {
  const ajv = validator(of);
  const schemas = described(of);
  const routes = listed(of);
  const compiled = new Map<string, ValidateFunction>();
  const counted = new Map<string, number>([...schemas.keys()].map((route) => [route, 0]));
  const found: string[] = [];
  for (const answer of answers) {
    // Matched among every route listed, so an answer of a route not yet
    // described (`/search/diagram/summary`) is never taken for a template's.
    const route = routeOf(routes, answer.method, answer.path);
    if (!route || !schemas.has(route)) continue;
    counted.set(route, (counted.get(route) ?? 0) + 1);
    const validate = compiled.get(route) ?? ajv.compile(refsTo(schemas.get(route)) as Schema);
    compiled.set(route, validate);
    if (!validate(parse(answer.body)))
      found.push(...problems(validate.errors).map((e) => line(route, answer.source, e)));
  }
  return { counted, found };
}

describe('recorded answers against the API description', () => {
  const { answers } = recordedAnswers();

  /** Described routes with no recorded answer, and why. */
  const UNRECORDED: Record<string, string> = {
    'GET /ContentService/search/facet':
      'not in the recordings, which always search with a query (calls.ts names the gap)',
    'GET /ContentService/search/query/paginated': 'no call of the site reads it',
  };

  it('has a recorded answer for every route the contract describes, but those listed', () => {
    const { counted } = check(description, answers);
    expect([...counted].filter(([, n]) => n === 0).map(([route]) => route)).toEqual(
      Object.keys(UNRECORDED)
    );
  }, 60_000);

  it('finds every recorded answer of a described route as the description says', () => {
    expect(check(description, answers).found.slice(0, 40)).toEqual([]);
  }, 60_000);

  // The search entry is exactly one of its kinds (FR-004): a check that could
  // not see an entry match none, or two, would not hold that.
  const entry = description.components.schemas['SearchEntry'] as { oneOf: Schema[] };
  const withKinds = (kinds: Schema[]): Description => ({
    ...description,
    components: {
      schemas: { ...description.components.schemas, SearchEntry: { ...entry, oneOf: kinds } },
    },
  });
  const unionProblems = (of: Description) =>
    check(of, answers).found.filter((p) => p.includes('must match exactly one schema'));

  // The kinds in the union's order (search.ts). No recorded answer has a
  // person's entry, so removing that kind fails nothing.
  const KINDS = [
    'EventEntry',
    'EntityEntry',
    'IconEntry',
    'PersonEntry',
    'InteractorEntry',
    'DeletedEntry',
  ];
  const RECORDED = KINDS.filter((kind) => kind !== 'PersonEntry');

  it('fails the entries of a kind the description lacks', () => {
    expect(entry.oneOf).toHaveLength(KINDS.length);
    const failing = KINDS.filter(
      (_, at) => unionProblems(withKinds(entry.oneOf.filter((__, i) => i !== at))).length > 0
    );
    expect(failing).toEqual(RECORDED);
  }, 60_000);

  it('fails an entry that two kinds both describe', () => {
    const [first] = entry.oneOf;
    expect(unionProblems(withKinds([...entry.oneOf, first as Schema])).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('the schema check', () => {
  const tiny = (schemas: Record<string, Schema>, answer: Schema): Description => ({
    paths: {
      '/ContentService/x': {
        get: { responses: { '200': { content: { 'application/json': { schema: answer } } } } },
      },
    },
    components: { schemas: { Long: LONG, ...schemas } },
  });
  const run = (of: Description, body: string) =>
    check(of, [{ method: 'GET', path: '/x', query: new URLSearchParams(), source: 't', body }])
      .found;

  it('keeps a long exact where JSON.parse would round it', () => {
    expect(parse('{"a":9007199254740993}')).toEqual({ a: 9007199254740993n });
    expect(parse('{"a":9007199254740991,"b":1.5,"c":1e300}')).toEqual({
      a: 9007199254740991,
      b: 1.5,
      c: 1e300,
    });
  });

  it('takes an exact long as a Long, and nowhere else', () => {
    const long = { $ref: '#/components/schemas/Long' };
    expect(run(tiny({}, long), '9007199254740993')).toEqual([]);
    expect(run(tiny({}, long), '9223372036854775808')).toHaveLength(1);
    expect(run(tiny({}, long), '1.5')).toHaveLength(1);
    expect(run(tiny({}, { type: 'integer' }), '9007199254740993')).toHaveLength(1);
    expect(run(tiny({}, { type: 'number' }), '9007199254740993')).toHaveLength(1);
  });

  it('counts a failure inside a union once, and one value once', () => {
    const union = {
      oneOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
        { type: 'object', required: ['b'], properties: { b: { type: 'string' } } },
      ],
    };
    expect(run(tiny({}, union), '{"c":1}')).toHaveLength(1);
    // Within the union's value: an entry of an array whose branches fail
    // deeper down is still one problem, at the entry.
    const deep = {
      oneOf: [
        {
          type: 'object',
          required: ['a'],
          properties: { a: { type: 'string' }, b: { $ref: '#/components/schemas/C' } },
        },
        { type: 'object', required: ['z'], properties: { z: {} } },
      ],
    };
    const entries = run(
      tiny(
        { C: { type: 'object', properties: { c: { type: 'string' } } } },
        { type: 'array', items: deep }
      ),
      '[{"a":1,"b":{"c":2}}, {"z":0}]'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain(' /0: must match exactly one schema');
    expect(run(tiny({}, union), '{"a":"x","b":"y"}')).toHaveLength(1);
    const two = { type: 'object', required: ['a', 'b'], properties: { a: {}, b: {} } };
    expect(run(tiny({}, two), '{}')).toHaveLength(1);
    expect(run(tiny({}, { type: 'array', items: two }), '[{}, {}]')).toHaveLength(2);
  });

  it('matches a path written in full before a templated one, with or without a slash', () => {
    const routes = ['GET /ContentService/s/{id}', 'GET /ContentService/s/query'];
    expect(routeOf(routes, 'GET', '/s/query')).toBe('GET /ContentService/s/query');
    expect(routeOf(routes, 'GET', '/s/R-HSA-1/')).toBe('GET /ContentService/s/{id}');
    expect(routeOf(routes, 'GET', '/s/a/b')).toBeUndefined();
    expect(routeOf(routes, 'POST', '/s/query')).toBeUndefined();
  });

  it('never checks the answer of a route not yet described against a template', () => {
    const of = tiny({}, { type: 'integer' });
    of.paths['/ContentService/{id}'] = of.paths['/ContentService/x'] ?? {};
    of.paths['/ContentService/summary'] = { get: { 'x-contract': 'not yet', responses: {} } };
    const answer = { method: 'GET', query: new URLSearchParams(), source: 't', body: '"text"' };
    expect(check(of, [{ ...answer, path: '/summary' }]).found).toEqual([]);
    expect(check(of, [{ ...answer, path: '/R-HSA-1' }]).found).toHaveLength(1);
  });

  it('refuses int64 anywhere but the Long', () => {
    expect(() => run(tiny({}, { type: 'integer', format: 'int64' }), '1')).toThrow(
      /unknown format/
    );
  });

  it('refuses a description whose Long is not what it reads', () => {
    expect(() =>
      validator({ paths: {}, components: { schemas: { Long: { type: 'integer' } } } })
    ).toThrow(/Long is not/);
  });
});
