// @vitest-environment node
//
// The invalid-input corpus (invalid-inputs.mjs) is what shows node answers a
// bad parameter as Java does before any answer is labelled cacheable. A
// corpus that repeated the parameter instead of replacing the sample's, or
// skipped an endpoint, would show nothing about the value it meant to try.
import { URLSearchParams } from 'node:url';
import { describe, expect, it } from 'vitest';
import { invalidInputs } from './invalid-inputs.mjs';
import { RECORD, declaredQuery } from './parameters.mjs';

const { endpoints } = await import('./service.mjs');
const GETS = endpoints.filter((e) => !e.method || e.method === 'GET');
const corpus = invalidInputs(GETS);

describe('invalidInputs', () => {
  it('tries every endpoint that declares a parameter of its own, unless it is never stored', () => {
    const tried = new Set(corpus.map((url) => url.split('?')[0]));
    for (const endpoint of GETS) {
      const own = declaredQuery(endpoint.path).filter(
        (p) => !['view', 'includeRef'].includes(p.name)
      );
      if (!own.length || RECORD[endpoint.path]?.cache) continue;
      const pattern = new RegExp(`^${endpoint.path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
      expect([endpoint.path, [...tried].some((path) => pattern.test(path))]).toEqual([
        endpoint.path,
        true,
      ]);
    }
  });

  it('gives each request one value for each parameter, the bad one replacing the sample’s', () => {
    for (const url of corpus) {
      const names = [...new URLSearchParams(url.split('?')[1])].map(([name]) => name);
      expect([url, names.length]).toEqual([url, new Set(names).size]);
    }
  });

  it('asks only for real objects, not placeholders', () => {
    expect(corpus.filter((url) => /\/X1(\/|\?|$)/.test(url))).toEqual([]);
  });
});
