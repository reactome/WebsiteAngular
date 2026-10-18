// @vitest-environment node
//
// snapshot-openapi.mjs reduces Java's API description to what the parameter
// record is checked against. A reduction that dropped a parameter, or a
// default, would let the record drift from Java unseen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { snapshotOf } from './snapshot-openapi.mjs';

const description = {
  openapi: '3.0.1',
  servers: [{ url: '/ContentService' }],
  paths: {
    '/b': {
      get: {
        responses: {},
        parameters: [
          {
            name: 'view',
            in: 'query',
            schema: { type: 'string', default: 'flatten', enum: ['flatten', 'nested'] },
          },
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'dropped',
          },
          { name: 'types', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
        ],
      },
    },
    '/a': { post: { responses: {} }, parameters: [] },
  },
};

describe('snapshotOf', () => {
  it("keeps each parameter's name, place, type, default, values and requirement, sorted", () => {
    expect(snapshotOf(description)).toEqual({
      openapi: '3.0.1',
      paths: {
        '/a': { post: [] },
        '/b': {
          get: [
            { name: 'id', in: 'path', type: 'string', required: true },
            { name: 'types', in: 'query', type: 'array', items: 'string' },
            {
              name: 'view',
              in: 'query',
              type: 'string',
              default: 'flatten',
              enum: ['flatten', 'nested'],
            },
          ],
        },
      },
    });
  });

  it("is what Java's description held when it was taken: Java's own spaced names included", () => {
    const snapshot = JSON.parse(
      readFileSync(new URL('./openapi-snapshot.json', import.meta.url), 'utf8')
    );
    expect(Object.keys(snapshot.paths).length).toBeGreaterThan(90);
    expect(snapshot.paths['/search/query'].get.map((p) => p.name)).toContain('Start row');
  });
});
