import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The library service as compose runs it (spec 015 T064): what keeps it
 * private, and what keeps it from being published.
 */
const compose = readFileSync(join(__dirname, '../../docker-compose.yml'), 'utf8');
const start = compose.indexOf('\n  java-library:\n');
// To the next service: the next key at two spaces' indent.
const next = /\n {2}[a-z][a-z-]*:\n/g;
next.lastIndex = start + 1;
const service = compose.slice(start, next.exec(compose)?.index ?? compose.length);
const properties = readFileSync(
  join(__dirname, 'src/main/resources/application.properties'),
  'utf8'
);

describe('the library service in compose', () => {
  it('is there', () => {
    expect(start, 'no java-library service in docker-compose.yml').toBeGreaterThan(-1);
  });

  it('is reached on loopback only', () => {
    // Host networking publishes nothing; the service binds loopback itself.
    expect(service).toMatch(/^ {4}network_mode: host$/m);
    expect(service).not.toMatch(/^ {4}ports:/m);
    expect(properties).toMatch(/^server\.address=127\.0\.0\.1$/m);
  });

  it('is built here and never pulled from or pushed to a registry', () => {
    expect(service).toMatch(/^ {6}dockerfile: deploy\/java-library\/Dockerfile$/m);
    expect(service).not.toMatch(/^ {4}image:/m);
  });

  it('reads the graph credentials from a read-only mount', () => {
    expect(service).toMatch(/^ {6}- [^\n]*:\/run\/secrets\/content-node\.env:ro$/m);
    expect(service).toMatch(/^ {6}- LIBRARY_ENV_FILE=\/run\/secrets\/content-node\.env$/m);
  });

  it('keeps its heap within its limit', () => {
    expect(service).toMatch(/^ {4}mem_limit: 1536m$/m);
  });

  it('keeps its files in a named volume', () => {
    expect(service).toMatch(/^ {6}- java-library-cache:\/cache$/m);
    expect(compose).toMatch(/^ {2}java-library-cache:$/m);
  });
});
