// @vitest-environment node
//
// The API description (spec 016, US4): generated from the contract, its route
// table held to the service's registry, and the committed file current.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESCRIPTION, componentName, generate, servedRoutes, written } from './generate.ts';

/** The contract's route table's keys, as the routes module declares them. */
function contractRoutes(source: string): string[] {
  return [...source.matchAll(/^ {2}'((?:GET|POST) [^']+)':/gm)].map((match) => match[1] ?? '');
}

const ROUTES = readFileSync(new URL('../../projects/contract/routes.ts', import.meta.url), 'utf8');

describe('the API description', () => {
  it('describes only routes the service serves', () => {
    const served = new Set(servedRoutes());
    expect(contractRoutes(ROUTES).filter((route) => !served.has(route))).toEqual([]);
  });

  it('lists every served route, the ones the contract lacks marked not yet', () => {
    const document = generate();
    const described = new Set(contractRoutes(ROUTES));
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
