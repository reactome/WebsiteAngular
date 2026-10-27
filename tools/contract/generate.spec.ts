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

describe('the API description', () => {
  it('describes only routes the service serves', () => {
    const served = new Set(servedRoutes());
    expect(contractRoutes().filter((route) => !served.has(route))).toEqual([]);
  });

  it('lists every served route, the ones the contract lacks marked not yet', () => {
    const document = generate();
    const described = new Set(contractRoutes());
    for (const route of servedRoutes()) {
      const [method = '', where = ''] = route.split(' ');
      const operation = document.paths[where]?.[method.toLowerCase()];
      expect(operation, route).toBeDefined();
      expect(operation?.['x-contract'], route).toBe(described.has(route) ? undefined : 'not yet');
    }
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
        const declared = ((operation['parameters'] ?? []) as { name: string }[]).map((p) => p.name);
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
