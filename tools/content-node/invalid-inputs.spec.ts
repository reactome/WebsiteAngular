// @vitest-environment node
//
// The invalid-input corpus (invalid-inputs.ts) is what shows node answers a
// bad parameter as Java does before any answer is labelled cacheable. A
// corpus that repeated the parameter instead of replacing the sample's, or
// skipped an endpoint, would show nothing about the value it meant to try.
import { URLSearchParams } from 'node:url';
import { describe, expect, it } from 'vitest';
import { invalidInputs } from './invalid-inputs.ts';
import { RECORD, declaredQuery } from './parameters.ts';

const { endpoints } = await import('./service.ts');
const GETS = endpoints.filter((e: { method?: string }) => !e.method || e.method === 'GET');
const corpus = invalidInputs(GETS);

describe('invalidInputs', () => {
  it('tries every endpoint that declares a parameter of its own, unless it is never stored', () => {
    const tried = new Set(corpus.map((url) => url.split('?')[0] ?? ''));
    for (const endpoint of GETS) {
      const own = declaredQuery(endpoint.path ?? '').filter(
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

  it('carries every required parameter but the one being tried, so that one is reached', () => {
    for (const url of corpus) {
      const [path = '', query] = url.split('?');
      const endpoint = GETS.find((e: { path: string }) =>
        new RegExp(`^${e.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path)
      );
      const given = new Set([...new URLSearchParams(query)].map(([name]) => name));
      const missing = declaredQuery(endpoint.path ?? '').filter(
        (p) => p.required && !given.has(p.name)
      );
      expect([url, missing.map((p) => p.name)]).toEqual([url, []]);
    }
  });

  it('asks only for real objects, not placeholders', () => {
    expect(corpus.filter((url) => /\/X1(\/|\?|$)/.test(url))).toEqual([]);
  });
});
