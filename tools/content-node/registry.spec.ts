// @vitest-environment node
//
// The order requests are matched in (spec 014, research R3). Express takes the
// first route that matches, in the endpoint list's order, and so do
// endpointFor and getEndpointFor. Fifteen pairs of routes can match one URL --
// /data/query/enhanced/{id} and /data/query/{id}/{attribute}, say -- so which
// comes first decides which answers. Splitting the service into modules must
// not change it: the list is held to today's, recorded, and the overlapping
// pairs to the fifteen measured.
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const { endpoints } = (await import('./service.ts')) as {
  endpoints: { path: string; method?: string }[];
};
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/route-order.json', import.meta.url), 'utf8')
) as string[];
const routes = endpoints.map((e) => `${(e.method ?? 'get').toUpperCase()} ${e.path}`);

/**
 * Whether one URL can match both templates, as Express matches them: as many
 * segments, and at each either the same literal or a variable on one side.
 */
function overlap(a: string, b: string): boolean {
  const variable = (segment: string) => /^\{\w+\}$/.test(segment);
  const x = a.split('/');
  const y = b.split('/');
  return (
    x.length === y.length &&
    x.every((segment, at) => {
      const other = y[at] ?? '';
      return segment === other || variable(segment) || variable(other);
    })
  );
}

/** Pairs of routes, same method, that some URL matches both of, in list order. */
function overlapping(list: string[]): string[] {
  const pairs: string[] = [];
  list.forEach((a, i) =>
    list.forEach((b, j) => {
      const [methodA = '', pathA = ''] = a.split(' ');
      const [methodB = '', pathB = ''] = b.split(' ');
      if (j > i && methodA === methodB && overlap(pathA, pathB))
        pairs.push(
          `${pathA.replace('/ContentService', '')} before ${pathB.replace('/ContentService', '')}`
        );
    })
  );
  return pairs;
}

/** The 15 pairs whose order decides which answers, measured (research R3), each the first first. */
const PAIRS = [
  '/data/person/{id}/publications before /data/person/{id}/{attribute}',
  '/data/person/{id}/authoredPathways before /data/person/{id}/{attribute}',
  '/data/person/{id}/authoredReactions before /data/person/{id}/{attribute}',
  '/data/person/{id}/reviewedPathways before /data/person/{id}/{attribute}',
  '/data/person/{id}/reviewedReactions before /data/person/{id}/{attribute}',
  '/data/query/enhanced/{id} before /data/query/{id}/stId',
  '/data/query/enhanced/{id} before /data/query/{id}/normalPathway',
  '/data/query/enhanced/{id} before /data/query/{id}/{attribute}',
  '/data/query/{id}/stId before /data/query/{id}/{attribute}',
  '/data/query/ids/map before /data/query/{id}/{attribute}',
  '/data/query/{id}/normalPathway before /data/query/{id}/{attribute}',
  '/data/schema/model before /data/schema/{id}',
  '/search/diagram/summary before /search/diagram/{diagram}',
  '/search/icon/facet before /search/icon/{identifier}',
  '/search/icon/query before /search/icon/{identifier}',
];

/** Pairs, any method, some path matches both of: endpointFor (the parity harness, the URIError handler) does not look at the method. */
function overlappingAnyMethod(list: string[]): string[] {
  const pairs: string[] = [];
  list.forEach((a, i) =>
    list.forEach((b, j) => {
      const [methodA = '', pathA = ''] = a.split(' ');
      const [methodB = '', pathB = ''] = b.split(' ');
      if (j > i && methodA !== methodB && overlap(pathA, pathB))
        pairs.push(
          `${a.replace('/ContentService', '')} before ${b.replace('/ContentService', '')}`
        );
    })
  );
  return pairs;
}

/** The 4 pairs across methods, measured, as endpointFor meets them. */
const PAIRS_ANY_METHOD = [
  'GET /data/query/{id} before POST /data/query/ids',
  'POST /data/query/ids/map before GET /data/query/ids/map',
  'POST /data/query/ids/map before GET /data/query/{id}/{attribute}',
  'POST /references/mapping/xrefs before GET /references/mapping/{identifier}',
];

/**
 * Reads of the endpoint list that pick one endpoint out by its path: a helper
 * reaching into the list for another endpoint's answer, as the release lookup
 * once did (research R2). A family module doing that would import the
 * registry, which assembles the families: a cycle. boundaries.spec.ts holds
 * the rule on imports; this catches the lookup itself, in any module, however
 * it is written: a list method whose callback reads `path` beside a path,
 * endpointFor or getEndpointFor given a path, or a loop over the list that
 * compares with one.
 */
function lookupsByPath(source: string): string[] {
  const sf = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const isPath = (n: ts.Node) =>
    (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.startsWith('/');
  const has = (n: ts.Node, test: (m: ts.Node) => boolean): boolean =>
    test(n) || (ts.forEachChild(n, (child) => (has(child, test) ? true : undefined)) ?? false);
  const readsPath = (n: ts.Node) => ts.isIdentifier(n) && n.text === 'path';
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'endpoints' &&
        n.arguments.some((argument) => has(argument, readsPath) && has(argument, isPath))
      )
        found.push(n.getText(sf));
      if (
        ts.isIdentifier(callee) &&
        ['endpointFor', 'getEndpointFor'].includes(callee.text) &&
        n.arguments[0] !== undefined &&
        isPath(n.arguments[0])
      )
        found.push(n.getText(sf));
    }
    if (
      ts.isForOfStatement(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'endpoints' &&
      has(n.statement, readsPath) &&
      has(n.statement, isPath)
    )
      found.push(n.getText(sf).split('\n')[0] ?? '');
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The service's modules, the tools that read the list (diff, invalid-inputs) aside. */
const MODULES = readdirSync(new URL('./', import.meta.url))
  .filter((file) => file.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(file))
  .filter((file) => !['diff.ts', 'invalid-inputs.ts'].includes(file));

describe('the endpoint list', () => {
  it('is not read by a helper looking an endpoint up by its path, in any module', () => {
    const found = MODULES.flatMap((file) =>
      lookupsByPath(readFileSync(new URL(file, import.meta.url), 'utf8')).map(
        (lookup) => `${file}: ${lookup}`
      )
    );
    expect(found).toEqual([]);
  });

  it('sees a lookup however it is written', () => {
    for (const lookup of [
      "const version = endpoints.find((e) => e.path.endsWith('/data/database/version'));",
      "const v = endpoints.find((e) =>\n  e.path.endsWith('/data/database/version'));",
      "const v = endpoints.find(({ path }) => path === '/ContentService/data/database/version');",
      "const v = endpoints.findLast(function (e) { return /version$/.test(e.path) || e.path === '/x'; });",
      "const v = endpointFor('/ContentService/data/database/version');",
      "for (const e of endpoints) if (e.path === '/ContentService/data/database/version') v = e;",
    ])
      expect([lookup, lookupsByPath(lookup)]).toEqual([lookup, [expect.any(String)]]);
    // Reading the list for every endpoint is not a lookup.
    expect(lookupsByPath('for (const e of endpoints) server.get(e.path, handle(e));')).toEqual([]);
    expect(lookupsByPath('const n = endpoints.filter((e) => !e.method).length;')).toEqual([]);
  });

  it('is matched in the recorded order', () => {
    expect(routes).toEqual(RECORDED);
  });

  it('keeps every pair of routes that can match one URL in the order measured', () => {
    // Independent of the recording: a pair swapped in both the list and the
    // recording is still named here, and a new pair (an endpoint added that
    // overlaps another) is shown, to be placed knowingly.
    expect(overlapping(routes)).toEqual(PAIRS);
  });

  it('keeps the pairs that overlap across methods in the order measured, as endpointFor reads them', () => {
    expect(overlappingAnyMethod(routes)).toEqual(PAIRS_ANY_METHOD);
  });
});
