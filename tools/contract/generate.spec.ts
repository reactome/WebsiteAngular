// @vitest-environment node
//
// The API description (spec 016, US4): generated from the contract, its route
// table held to the service's registry, and the committed file current.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION,
  componentName,
  components,
  contractRoutes,
  generate,
  servedRoutes,
  written,
} from './generate.ts';

// Each generation takes over a second, and the first two tests about 4.5 s
// alone, near vitest's 5 s default: under the pre-push hook's load, one timed
// out (T024). They have 60 s, as the schema check's do.
describe('the API description', { timeout: 60_000 }, () => {
  it('describes only routes the service serves', () => {
    const served = new Set(servedRoutes());
    expect(contractRoutes().filter((route) => !served.has(route))).toEqual([]);
  });

  it('lists every served route, the ones the contract lacks marked not yet', () => {
    const document = generate();
    const described = new Set(contractRoutes());
    // A route Java documents under narrower paths (/exporter/diagram/{id} as
    // /exporter/diagram/{identifier}.{ext}) is listed as those.
    const narrower = (route: string) => {
      const [method = '', where = ''] = route.split(' ');
      const pattern = new RegExp(`^${where.split(/\{[^}]+\}/).join('[^/]+')}$`);
      return Object.entries(document.paths).filter(
        ([path, operations]) =>
          path !== where && pattern.test(path) && operations[method.toLowerCase()]
      );
    };
    for (const route of servedRoutes()) {
      const [method = '', where = ''] = route.split(' ');
      const operation = document.paths[where]?.[method.toLowerCase()];
      if (!operation) expect(narrower(route), route).not.toEqual([]);
      else
        expect(operation['x-contract'], route).toBe(described.has(route) ? undefined : 'not yet');
    }
  });

  it('documents each operation as Java does, where Java documents it', () => {
    const listing = generate().paths['/ContentService/data/pathways/low/entity/{id}']?.['get'];
    expect(listing?.['operationId']).toBe('getPathwaysFor');
    expect(listing?.['tags']).toEqual(['pathways']);
    const parameters = (listing?.['parameters'] ?? []) as { name: string; in: string }[];
    expect(parameters.map((p) => `${p.in} ${p.name}`)).toEqual([
      'path id',
      'query species',
      'query view',
      'query includeRef',
    ]);
  });

  it('keeps what Java answers with a status besides 200, without its schemas', () => {
    const responses = generate().paths['/ContentService/data/pathways/low/entity/{id}']?.['get']?.[
      'responses'
    ] as Record<string, { description: string; content?: unknown }>;
    expect(Object.keys(responses).sort()).toContain('404');
    expect(JSON.stringify(responses)).not.toContain('$ref');
  });

  it('is the committed file: regenerate it with `node tools/contract/generate.ts`', () => {
    expect(readFileSync(DESCRIPTION, 'utf8')).toBe(written());
  });

  it('writes the search entry as exactly one of its kinds', () => {
    const entry = generate().components.schemas['SearchEntry'] as {
      oneOf?: unknown[];
      anyOf?: unknown;
    };
    expect(entry.anyOf).toBeUndefined();
    expect(entry.oneOf).toHaveLength(6);
  });

  it('declares every templated path variable, as OpenAPI requires', () => {
    for (const [where, operations] of Object.entries(generate().paths))
      for (const operation of Object.values(operations)) {
        const declared = ((operation['parameters'] ?? []) as { name: string; in: string }[])
          .filter((p) => p.in === 'path')
          .map((p) => p.name);
        const templated = [...where.matchAll(/\{([^}]+)\}/g)].map(([, name]) => name);
        expect(declared, where).toEqual(templated);
      }
  });

  it('refuses two types whose component names would clash', () => {
    expect(() => components({ 'A<B, C>': {}, 'A<B_C>': {} })).toThrow(/clash: A_B_C/);
    expect(Object.keys(components({ 'B<X>': {}, A: {} }))).toEqual(['A', 'B_X']);
  });

  it('names a generic instance as OpenAPI allows', () => {
    expect(componentName('GroupedResult<SearchEntry>')).toBe('GroupedResult_SearchEntry');
    expect(componentName('Map<string, ResultGroup<IconEntry>>')).toBe(
      'Map_string_ResultGroup_IconEntry'
    );
    expect(Object.keys(generate().components.schemas).every((name) => /^[\w.-]+$/.test(name))).toBe(
      true
    );
  });
});
