// @vitest-environment node
//
// The order requests are matched in (spec 014, research R3). Express takes the
// first route that matches, in the endpoint list's order, and so do
// endpointFor and getEndpointFor. Fifteen pairs of routes can match one URL --
// /data/query/enhanced/{id} and /data/query/{id}/{attribute}, say -- so which
// comes first decides which answers. Splitting the service into modules must
// not change it: the list is held to today's, recorded, and the overlapping
// pairs to the fifteen measured.
import { readFileSync } from 'node:fs';
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

describe('the endpoint list', () => {
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
