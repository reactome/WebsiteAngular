// @vitest-environment node
//
// The order requests are matched in (spec 014, research R3). Express takes the
// first route that matches, in the endpoint list's order, and so do
// endpointFor and getEndpointFor. Thirteen pairs of routes can match one URL --
// /data/query/enhanced/{id} and /data/query/{id}/{attribute}, say -- so which
// comes first decides which answers. Splitting the service into modules must
// not change it: the list is held to today's, recorded, and the overlapping
// pairs to the thirteen measured.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { endpoints } = (await import('./service.ts')) as {
  endpoints: { path: string; method?: string }[];
};
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/route-order.json', import.meta.url), 'utf8')
) as string[];
const routes = endpoints.map((e) => `${(e.method ?? 'get').toUpperCase()} ${e.path}`);

/** A route's template as the pattern Express matches (a variable is one segment). */
const pattern = (template: string) =>
  new RegExp(
    `^${template
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}/?$`
  );
const fill = (template: string, value: string) => template.replace(/\{\w+\}/g, value);

/** Pairs of routes, same method, that some URL matches both of: first, second in list order. */
function overlapping(list: string[]): string[] {
  const pairs: string[] = [];
  list.forEach((a, i) =>
    list.forEach((b, j) => {
      if (j <= i) return;
      const [methodA = '', pathA = ''] = a.split(' ');
      const [methodB = '', pathB = ''] = b.split(' ');
      if (methodA !== methodB) return;
      const overlap = ['x', 'R-HSA-1'].some(
        (value) =>
          pattern(pathA).test(fill(pathB, value)) || pattern(pathB).test(fill(pathA, value))
      );
      if (overlap) pairs.push(`${pathA} before ${pathB}`);
    })
  );
  return pairs;
}

describe('the endpoint list', () => {
  it('is matched in the recorded order', () => {
    expect(routes).toEqual(RECORDED);
  });

  it('keeps every pair of routes that can match one URL in the recorded order', () => {
    // A pair the recording has the other way round is named; a new pair (an
    // endpoint added that overlaps another) is shown, to be placed knowingly.
    expect(overlapping(routes)).toEqual(overlapping(RECORDED));
    expect(overlapping(RECORDED)).toHaveLength(13);
  });
});
