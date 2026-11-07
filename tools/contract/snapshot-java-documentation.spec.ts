// @vitest-environment node
//
// What the snapshot of Java's documentation keeps (spec 016, T028): every
// word of each operation, and of each status but its answers' schemas.
import { describe, expect, it } from 'vitest';
import { documentation } from './snapshot-java-documentation.ts';

const JAVA = {
  openapi: '3.0.1',
  info: { title: 'Content Service', version: '1.2' },
  servers: [{ url: '/ContentService' }],
  tags: [
    { name: 'species', description: 'Species queries' },
    { name: 'events', description: 'Event queries' },
  ],
  paths: {
    '/data/species/all': {
      get: {
        tags: ['species'],
        summary: 'The list of all species',
        operationId: 'getAllSpecies',
        parameters: [{ name: 'view', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Species' } } },
          },
          '404': { description: 'Not found', content: { '*/*': { schema: { type: 'object' } } } },
        },
      },
    },
  },
  components: { schemas: { Species: { type: 'object' } } },
};

describe('the snapshot of Java’s documentation', () => {
  const kept = documentation(JAVA);

  it('keeps each operation as Java documents it', () => {
    const operation = kept.paths['/data/species/all']?.['get'];
    expect(operation?.operationId).toBe('getAllSpecies');
    expect(operation?.tags).toEqual(['species']);
    expect(operation?.parameters).toEqual([
      { in: 'query', name: 'view', schema: { type: 'string' } },
    ]);
  });

  it('keeps what each status means and its media types, but no schema', () => {
    expect(kept.paths['/data/species/all']?.['get']?.responses).toEqual({
      '200': { description: 'OK', mediaTypes: ['application/json'] },
      '404': { description: 'Not found', mediaTypes: ['*/*'] },
    });
    expect(JSON.stringify(kept)).not.toContain('$ref');
  });

  it('keeps the groups in Java’s order, and leaves out the servers and components', () => {
    expect(kept.tags.map((tag) => tag.name)).toEqual(['species', 'events']);
    expect(Object.keys(kept).sort()).toEqual(['info', 'paths', 'tags']);
  });

  it('refuses what is not a description', () => {
    expect(() => documentation({ swagger: '2.0' })).toThrow('not an OpenAPI description');
  });
});
