// @vitest-environment node
//
// Every recorded answer of a route the contract describes, against the schema
// the API description gives it (spec 016, T021): ajv over openapi.json, the
// generated description, where content.spec.ts compiles answers against the
// site's types. The two are checked apart: the generator is an approximation
// of the types, and this holds what it wrote to the answers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESCRIPTION } from '../contract/generate.ts';
import { recordedAnswers } from './answers.ts';
import { type Description, LONG, type Schema, check, parse, routeOf, validator } from './schema.ts';

const description = JSON.parse(readFileSync(DESCRIPTION, 'utf8')) as Description;

describe('recorded answers against the API description', () => {
  const { answers } = recordedAnswers();

  /** Described routes with no recorded answer, and why. */
  const UNRECORDED: Record<string, string> = {
    'GET /ContentService/citation/pathway/{id}':
      'not in the recordings, which never cite a pathway (calls.ts names the gap)',
    'GET /ContentService/data/instance/{id}/referrers':
      'not in the recordings, which never open an instance’s referrers (calls.ts names the gap)',
    'GET /ContentService/data/query/{id}/more':
      'no call of the site reads it: Java keeps it for old callers (spec 006 T104)',
    'GET /ContentService/data/schema/{id}/min':
      'not in the recordings, which never open a class’s instances (calls.ts names the gap)',
    'GET /ContentService/interactors/static/molecule/{id}/details':
      'not in the recordings, which never open an interactor popup (calls.ts names the gap)',
    'GET /ContentService/search/facet':
      'not in the recordings, which always search with a query (calls.ts names the gap)',
    'GET /ContentService/search/fireworks/flag':
      'recorded only as aborted requests, which have no answer (calls.ts names the gap)',
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
  // Only the search's answers hold entries: the graph's, 7.8 MB of them, would
  // be checked once per kind for nothing, which took the test past its limit.
  const searchAnswers = answers.filter((a) => a.path.startsWith('/search/'));
  const unionProblems = (of: Description) =>
    check(of, searchAnswers).found.filter((p) => p.includes('must match exactly one schema'));

  // The kinds in the union's order (search.ts). No recorded answer has a
  // person's entry, so removing that kind fails nothing. Nor, since the
  // recordings moved to release 98, a deleted object's: release 97's search
  // offered two for TP53, and release 98's offers none for anything the
  // tests ask.
  const KINDS = [
    'EventEntry',
    'EntityEntry',
    'IconEntry',
    'PersonEntry',
    'InteractorEntry',
    'DeletedEntry',
  ];
  const RECORDED = KINDS.filter((kind) => kind !== 'PersonEntry' && kind !== 'DeletedEntry');

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

describe('what the description requires, measured against live answers', () => {
  it('lets a failed reaction leave out what one nested in another answer has none of', () => {
    // A failed reaction in another's diseaseReactions or inputFor (beta,
    // release 98, 25 Nov 2026: R-HSA-9007926, R-HSA-9007919) carries no
    // catalystActivity, composedOf or eventOfPathways. The recordings never held
    // such an answer, so the type required all three, as no other reaction type
    // does, and every one of these answers failed it (specs/032 T013).
    const failed = description.components.schemas['FailedReaction_JsogReference'] as {
      required: string[];
    };
    for (const field of ['catalystActivity', 'composedOf', 'eventOfPathways'])
      expect(failed.required, field).not.toContain(field);
  });
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
